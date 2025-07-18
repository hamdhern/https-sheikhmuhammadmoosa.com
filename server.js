const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); // Serve static files from current directory

// Database connection configuration
const dbConfig = {
  host: 'switchback.proxy.rlwy.net',
  user: 'root',
  password: 'uJXiSTNxbcKldDxZoimECGWVUesYaIIM', // your MySQL password
  database: 'railway',
  port: 21241, // replace with your actual port if it's different
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

let db;

// Initialize database connection
const initDB = async () => {
    try {
        // Connect directly to the database
        db = await mysql.createConnection(dbConfig);

        // Create videos table if it doesn't exist
        await db.execute(`
            CREATE TABLE IF NOT EXISTS videos (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(500) NOT NULL,
                file_url VARCHAR(1000) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_title (title(255))
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // Create releases table if it doesn't exist
        await db.execute(`
            CREATE TABLE IF NOT EXISTS releases (
                id INT AUTO_INCREMENT PRIMARY KEY,
                youtube_video_id VARCHAR(255) UNIQUE NOT NULL,
                title VARCHAR(500) NOT NULL,
                description TEXT,
                youtube_url VARCHAR(1000) NOT NULL,
                thumbnail_url VARCHAR(500),
                published_at DATETIME,
                channel_title VARCHAR(255),
                status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_status (status),
                INDEX idx_youtube_id (youtube_video_id),
                INDEX idx_release_title (title(255))
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        console.log('Database initialized successfully');
    } catch (error) {
        console.error('Database initialization error:', error);
        process.exit(1);
    }
};

// API Routes

// Get all videos with pagination and search
app.get('/api/videos', async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 5)); // Limit between 1-100
        const search = (req.query.search || '').trim();
        const offset = (page - 1) * limit;

        let query = 'SELECT * FROM videos';
        let countQuery = 'SELECT COUNT(*) as total FROM videos';
        let params = [];
        let countParams = [];

        if (search) {
            query += ' WHERE title LIKE ?';
            countQuery += ' WHERE title LIKE ?';
            const searchParam = `%${search}%`;
            params.push(searchParam);
            countParams.push(searchParam);
        }

        query += ` ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;

        console.log('Executing query:', query);
        console.log('With params:', params);

        const [videos] = await db.execute(query, params);
        const [countResult] = await db.execute(countQuery, countParams);
        
        const total = countResult[0].total;
        const totalPages = Math.ceil(total / limit);

        res.json({
            videos,
            pagination: {
                currentPage: page,
                totalPages,
                totalVideos: total,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1
            }
        });
    } catch (error) {
        console.error('Error fetching videos:', error);
        res.status(500).json({ error: 'Failed to fetch videos' });
    }
});

// Get single video by ID
app.get('/api/videos/:id', async (req, res) => {
    try {
        const [videos] = await db.execute('SELECT * FROM videos WHERE id = ?', [req.params.id]);
        
        if (videos.length === 0) {
            return res.status(404).json({ error: 'Video not found' });
        }

        res.json(videos[0]);
    } catch (error) {
        console.error('Error fetching video:', error);
        res.status(500).json({ error: 'Failed to fetch video' });
    }
});

// Add new video
app.post('/api/videos', async (req, res) => {
    try {
        const { title, file_url } = req.body;

        if (!title || !file_url) {
            return res.status(400).json({ error: 'Title and file_url are required' });
        }

        const [result] = await db.execute(
            'INSERT INTO videos (title, file_url) VALUES (?, ?)',
            [title, file_url]
        );

        const [newVideo] = await db.execute('SELECT * FROM videos WHERE id = ?', [result.insertId]);
        
        res.status(201).json(newVideo[0]);
    } catch (error) {
        console.error('Error adding video:', error);
        res.status(500).json({ error: 'Failed to add video' });
    }
});

// Update video
app.put('/api/videos/:id', async (req, res) => {
    try {
        const { title, file_url } = req.body;
        const videoId = req.params.id;

        if (!title || !file_url) {
            return res.status(400).json({ error: 'Title and file_url are required' });
        }

        const [result] = await db.execute(
            'UPDATE videos SET title = ?, file_url = ? WHERE id = ?',
            [title, file_url, videoId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Video not found' });
        }

        const [updatedVideo] = await db.execute('SELECT * FROM videos WHERE id = ?', [videoId]);
        
        res.json(updatedVideo[0]);
    } catch (error) {
        console.error('Error updating video:', error);
        res.status(500).json({ error: 'Failed to update video' });
    }
});

// Delete video
app.delete('/api/videos/:id', async (req, res) => {
    try {
        const [result] = await db.execute('DELETE FROM videos WHERE id = ?', [req.params.id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Video not found' });
        }

        res.json({ message: 'Video deleted successfully' });
    } catch (error) {
        console.error('Error deleting video:', error);
        res.status(500).json({ error: 'Failed to delete video' });
    }
});

// Releases API Routes

// Get all releases with pagination and search
app.get('/api/releases', async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 10));
        const search = (req.query.search || '').trim();
        const status = req.query.status || 'pending'; // Default to pending
        const offset = (page - 1) * limit;

        let query = 'SELECT * FROM releases';
        let countQuery = 'SELECT COUNT(*) as total FROM releases';
        let params = [];
        let countParams = [];

        // Build WHERE clause
        let whereConditions = [];
        
        if (status && status !== 'all') {
            whereConditions.push('status = ?');
            params.push(status);
            countParams.push(status);
        }
        
        if (search) {
            whereConditions.push('title LIKE ?');
            const searchParam = `%${search}%`;
            params.push(searchParam);
            countParams.push(searchParam);
        }
        
        if (whereConditions.length > 0) {
            const whereClause = ' WHERE ' + whereConditions.join(' AND ');
            query += whereClause;
            countQuery += whereClause;
        }

        query += ` ORDER BY published_at DESC LIMIT ${limit} OFFSET ${offset}`;

        const [releases] = await db.execute(query, params);
        const [countResult] = await db.execute(countQuery, countParams);
        
        const total = countResult[0].total;
        const totalPages = Math.ceil(total / limit);

        res.json({
            releases,
            pagination: {
                currentPage: page,
                totalPages,
                totalReleases: total,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1
            }
        });
    } catch (error) {
        console.error('Error fetching releases:', error);
        res.status(500).json({ error: 'Failed to fetch releases' });
    }
});

// Approve a release and add to videos table
app.post('/api/releases/:id/approve', async (req, res) => {
    try {
        const releaseId = req.params.id;
        const customTitle = (req.body && req.body.custom_title && req.body.custom_title.trim()) ? req.body.custom_title.trim() : null;

        // Get the release
        const [releases] = await db.execute('SELECT * FROM releases WHERE id = ?', [releaseId]);
        if (releases.length === 0) {
            return res.status(404).json({ error: 'Release not found' });
        }
        let release = releases[0];

        // If customTitle is provided, update the release title before approving
        if (customTitle) {
            await db.execute('UPDATE releases SET title = ? WHERE id = ?', [customTitle, releaseId]);
            release.title = customTitle;
        }

        // Add to videos table with the (possibly updated) title
        const [result] = await db.execute(
            'INSERT INTO videos (title, file_url) VALUES (?, ?)',
            [release.title, release.youtube_url]
        );

        // Update release status
        await db.execute(
            'UPDATE releases SET status = ? WHERE id = ?',
            ['approved', releaseId]
        );

        res.json({ 
            message: 'Release approved and added to videos',
            videoId: result.insertId
        });
    } catch (error) {
        console.error('Error approving release:', error);
        res.status(500).json({ error: 'Failed to approve release' });
    }
});

// Reject a release
app.post('/api/releases/:id/reject', async (req, res) => {
    try {
        const releaseId = req.params.id;
        
        const [result] = await db.execute(
            'UPDATE releases SET status = ? WHERE id = ?',
            ['rejected', releaseId]
        );
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Release not found' });
        }
        
        res.json({ message: 'Release rejected' });
    } catch (error) {
        console.error('Error rejecting release:', error);
        res.status(500).json({ error: 'Failed to reject release' });
    }
});

// Delete a release
app.delete('/api/releases/:id', async (req, res) => {
    try {
        const [result] = await db.execute('DELETE FROM releases WHERE id = ?', [req.params.id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Release not found' });
        }

        res.json({ message: 'Release deleted successfully' });
    } catch (error) {
        console.error('Error deleting release:', error);
        res.status(500).json({ error: 'Failed to delete release' });
    }
});

// Serve the main HTML files
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/video', (req, res) => {
    res.sendFile(path.join(__dirname, 'video.html'));
});

app.get('/audio', (req, res) => {
    res.sendFile(path.join(__dirname, 'audio.html'));
});

app.get('/about', (req, res) => {
    res.sendFile(path.join(__dirname, 'about.html'));
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        database: db ? 'Connected' : 'Disconnected'
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// Handle graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down gracefully');
    if (db) {
        await db.end();
    }
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('SIGINT received, shutting down gracefully');
    if (db) {
        await db.end();
    }
    process.exit(0);
});

// Start server
const startServer = async () => {
    await initDB();
    
    app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
        console.log(`API endpoints available at http://localhost:${PORT}/api/videos`);
    });
};

// Start the server
startServer().catch(console.error);
