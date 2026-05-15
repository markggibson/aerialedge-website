/*
 * menu-toggler.js
 *
 * Replaces v1's Foundation top-bar + jQuery toggler (app.js:285-289) with
 * vanilla JS. Phase 3 of the Astro migration; jQuery and foundation.min.js
 * are no longer loaded.
 *
 * Behaviour mirrors v1:
 *   $('#menu-toggler').click(function () {
 *     $('.top-bar-section').toggle();
 *   });
 *
 * In v1's CSS, `.top-bar-section.closed { display: none; }`. Foundation's
 * desktop media queries reveal the section regardless. So on mobile, toggling
 * the `.closed` class is the same display behaviour the v1 site shipped.
 */
(function () {
  function init() {
    var toggler = document.getElementById('menu-toggler');
    if (!toggler) return;

    var section = document.querySelector('.top-bar-section');
    if (!section) return;

    toggler.addEventListener('click', function (event) {
      event.preventDefault();
      section.classList.toggle('closed');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
