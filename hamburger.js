document.getElementById('hamburger').addEventListener('click', function () {
  const mobileMenu = document.getElementById('myLinks');
  mobileMenu.classList.toggle('show'); // Toggle the visibility of the mobile menu
  this.classList.toggle('active'); // Toggle the hamburger icon to transform into an "X"

  });
