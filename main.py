#!/usr/bin/env python3
"""
YouTube Channel Video Fetcher
Fetches videos from a specified YouTube channel and stores them as pending releases
"""

import os
import json
import mysql.connector
from datetime import datetime, timedelta
import requests
from dotenv import load_dotenv
import argparse
import sys

# Load environment variables
load_dotenv()

class YouTubeFetcher:
    def __init__(self):
        self.api_key = os.getenv('YOUTUBE_API_KEY')
        self.db_config = {
            'host': os.getenv('DB_HOST', 'localhost'),
            'user': os.getenv('DB_USER', 'root'),
            'password': os.getenv('DB_PASSWORD', 'B2007_bb_2021'),
            'database': os.getenv('DB_NAME', 'islamic_lectures'),
            'charset': 'utf8mb4'
        }
        
        if not self.api_key:
            print("Error: YOUTUBE_API_KEY not found in environment variables")
            print("Please add YOUTUBE_API_KEY=your_api_key to your .env file")
            sys.exit(1)
    
    def get_channel_id_from_username(self, username):
        """Get channel ID from username or handle"""
        url = "https://www.googleapis.com/youtube/v3/channels"
        params = {
            'part': 'id,snippet',
            'forUsername': username,
            'key': self.api_key
        }
        
        response = requests.get(url, params=params)
        data = response.json()
        
        if 'items' in data and len(data['items']) > 0:
            return data['items'][0]['id']
        
        # If username doesn't work, try searching for the channel
        search_url = "https://www.googleapis.com/youtube/v3/search"
        search_params = {
            'part': 'snippet',
            'q': username,
            'type': 'channel',
            'key': self.api_key,
            'maxResults': 1
        }
        
        search_response = requests.get(search_url, params=search_params)
        search_data = search_response.json()
        
        if 'items' in search_data and len(search_data['items']) > 0:
            return search_data['items'][0]['snippet']['channelId']
        
        return None
    
    def get_channel_videos(self, channel_id, max_results=50, days_back=30):
        """Fetch recent videos from a YouTube channel"""
        try:
            published_after = (datetime.now() - timedelta(days=days_back)).isoformat() + 'Z'
            # Get channel's uploads playlist ID
            channel_url = "https://www.googleapis.com/youtube/v3/channels"
            channel_params = {
                'part': 'contentDetails',
                'id': channel_id,
                'key': self.api_key
            }
            channel_response = requests.get(channel_url, params=channel_params)
            channel_data = channel_response.json()
            # Debug print
            #print('Channel API response:', json.dumps(channel_data, indent=2))
            if 'items' not in channel_data or len(channel_data['items']) == 0:
                print(f"Channel not found or no content: {channel_id}")
                return []
            uploads_playlist_id = channel_data['items'][0]['contentDetails']['relatedPlaylists']['uploads']
            # Get videos from uploads playlist
            playlist_url = "https://www.googleapis.com/youtube/v3/playlistItems"
            params = {
                'part': 'snippet',
                'playlistId': uploads_playlist_id,
                'maxResults': 50,  # Always fetch 50 per page for pagination
                'key': self.api_key
            }
            all_videos = []
            next_page_token = None
            while len(all_videos) < max_results:
                if next_page_token:
                    params['pageToken'] = next_page_token
                response = requests.get(playlist_url, params=params)
                data = response.json()
                print('\n[DEBUG] Playlist API response:', json.dumps(data, indent=2))
                if 'items' not in data or not data['items']:
                    break
                for item in data['items']:
                    snippet = item['snippet']
                    published_date = datetime.fromisoformat(snippet['publishedAt'].replace('Z', '+00:00'))
                    cutoff_date = datetime.now().replace(tzinfo=published_date.tzinfo) - timedelta(days=days_back)
                    if published_date < cutoff_date:
                        continue
                    description = snippet['description']
                    if description and 'މޫސާ' in description:
                        video_info = {
                            'video_id': snippet['resourceId']['videoId'],
                            'title': snippet['title'],
                            'description': description,
                            'published_at': snippet['publishedAt'],
                            'thumbnail_url': snippet['thumbnails'].get('high', {}).get('url', ''),
                            'channel_title': snippet['channelTitle'],
                            'url': f"https://www.youtube.com/watch?v={snippet['resourceId']['videoId']}"
                        }
                        all_videos.append(video_info)
                next_page_token = data.get('nextPageToken')
                if not next_page_token:
                    break
            return all_videos[:max_results]
        except Exception as e:
            print(f"Error fetching videos: {str(e)}")
            return []
    
    def init_database(self):
        """Initialize database tables for releases"""
        try:
            conn = mysql.connector.connect(**self.db_config)
            cursor = conn.cursor()
            
            # Create releases table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS releases (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    youtube_video_id VARCHAR(255) UNIQUE NOT NULL,
                    title VARCHAR(500) NOT NULL,
                    description TEXT,
                    youtube_url VARCHAR(500) NOT NULL,
                    thumbnail_url VARCHAR(500),
                    published_at DATETIME,
                    channel_title VARCHAR(255),
                    status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX idx_status (status),
                    INDEX idx_youtube_id (youtube_video_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            """)
            
            conn.commit()
            cursor.close()
            conn.close()
            print("Database initialized successfully")
            
        except Exception as e:
            print(f"Database initialization error: {str(e)}")
            return False
        
        return True
    
    def save_videos_to_releases(self, videos):
        """Save fetched videos to releases table"""
        if not videos:
            print("No videos to save")
            return 0
        
        try:
            conn = mysql.connector.connect(**self.db_config)
            cursor = conn.cursor()
            
            saved_count = 0
            skipped_count = 0
            
            for video in videos:
                try:
                    # Convert published_at to MySQL datetime format
                    published_datetime = datetime.fromisoformat(video['published_at'].replace('Z', '+00:00'))
                    
                    cursor.execute("""
                        INSERT INTO releases 
                        (youtube_video_id, title, description, youtube_url, thumbnail_url, published_at, channel_title)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                        ON DUPLICATE KEY UPDATE
                        title = VALUES(title),
                        description = VALUES(description),
                        thumbnail_url = VALUES(thumbnail_url),
                        updated_at = CURRENT_TIMESTAMP
                    """, (
                        video['video_id'],
                        video['title'],
                        video['description'][:1000] if video['description'] else '',  # Limit description length
                        video['url'],
                        video['thumbnail_url'],
                        published_datetime,
                        video['channel_title']
                    ))
                    
                    if cursor.rowcount > 0:
                        saved_count += 1
                        print(f"✓ Saved: {video['title'][:60]}...")
                    else:
                        skipped_count += 1
                        print(f"- Skipped (already exists): {video['title'][:60]}...")
                        
                except Exception as e:
                    print(f"✗ Error saving video '{video.get('title', 'Unknown')}': {str(e)}")
                    skipped_count += 1
            
            conn.commit()
            cursor.close()
            conn.close()
            
            print(f"\nSummary: {saved_count} videos saved, {skipped_count} skipped")
            return saved_count
            
        except Exception as e:
            print(f"Database error: {str(e)}")
            return 0
    
    def fetch_and_save(self, channel_identifier, max_results=50, days_back=30):
        """Main method to fetch videos and save to database"""
        print(f"Fetching videos from channel: {channel_identifier}")
        
        # Initialize database
        if not self.init_database():
            return False
        
        # Get channel ID if username/handle is provided
        if channel_identifier.startswith('UC'):
            channel_id = channel_identifier
        else:
            print(f"Looking up channel ID for: {channel_identifier}")
            channel_id = self.get_channel_id_from_username(channel_identifier)
            if not channel_id:
                print(f"Could not find channel: {channel_identifier}")
                return False
            print(f"Found channel ID: {channel_id}")
        # Fetch videos
        videos = self.get_channel_videos(channel_id, max_results, days_back)
        
        if not videos:
            print("No videos found")
            return False
        
        print(f"Found {len(videos)} videos from the last {days_back} days")
        
        # Save to database
        saved_count = self.save_videos_to_releases(videos)
        
        print(f"\nCompleted! {saved_count} new videos are ready for review in the admin panel.")
        return True

def main():
    parser = argparse.ArgumentParser(description='Fetch YouTube channel videos for review')
    parser.add_argument('--max-results', type=int, default=50, help='Maximum number of videos to fetch (default: 50)')
    parser.add_argument('--days-back', type=int, default=30, help='Fetch videos from the last N days (default: 30)')
    
    args = parser.parse_args()
    channel_id = "UC2ySSHS3VX2ytLbbr6d0CvA"
    fetcher = YouTubeFetcher()
    def do_fetch():
        success = fetcher.fetch_and_save(channel_id, args.max_results, args.days_back)
        if success:
            print(f"\n🎉 Success! Check the admin panel at http://localhost:3000/admin.html")
            print("Go to the 'Releases' tab to review and approve videos.")
        else:
            print("\n❌ Failed to fetch videos. Please check the errors above.")
    import schedule
    import time
    do_fetch()  # Run immediately on start
    schedule.every(3).days.do(do_fetch)
    print("[Scheduler] Auto-fetch scheduled every 3 days for channel: UC2ySSHS3VX2ytLbbr6d0CvA")
    while True:
        schedule.run_pending()
        time.sleep(60)

if __name__ == "__main__":
    main()
