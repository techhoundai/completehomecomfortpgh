document.addEventListener('DOMContentLoaded', () => {

  // Mobile navigation
  const hamburger = document.querySelector('.hamburger');
  const navMenu = document.querySelector('.nav-menu');
  const navOverlay = document.querySelector('.nav-overlay');

  function closeNav() {
    hamburger?.classList.remove('active');
    navMenu?.classList.remove('active');
    navOverlay?.classList.remove('active');
    document.body.style.overflow = '';
  }

  function openNav() {
    hamburger?.classList.add('active');
    navMenu?.classList.add('active');
    navOverlay?.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  hamburger?.addEventListener('click', () => {
    if (navMenu?.classList.contains('active')) {
      closeNav();
    } else {
      openNav();
    }
  });

  navOverlay?.addEventListener('click', closeNav);

  // Mobile dropdown toggles
  document.querySelectorAll('.nav-dropdown-toggle').forEach(toggle => {
    toggle.addEventListener('click', (e) => {
      if (window.innerWidth >= 1024) return;
      e.preventDefault();
      const menu = toggle.nextElementSibling;
      const isOpen = menu?.classList.contains('open');

      document.querySelectorAll('.nav-dropdown-menu').forEach(m => m.classList.remove('open'));
      document.querySelectorAll('.nav-dropdown-toggle').forEach(t => t.classList.remove('open'));

      if (!isOpen) {
        menu?.classList.add('open');
        toggle.classList.add('open');
      }
    });
  });

  // Close nav on link click
  navMenu?.querySelectorAll('a:not(.nav-dropdown-toggle)').forEach(link => {
    link.addEventListener('click', closeNav);
  });

  // Scroll animations
  const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);

  document.querySelectorAll('.fade-in, .fade-in-left, .fade-in-right').forEach(el => {
    observer.observe(el);
  });

  // Lightbox
  const lightbox = document.querySelector('.lightbox');
  if (lightbox) {
    const lightboxImg = lightbox.querySelector('img');
    const closeBtn = lightbox.querySelector('.lightbox-close');
    const prevBtn = lightbox.querySelector('.lightbox-prev');
    const nextBtn = lightbox.querySelector('.lightbox-next');
    const galleryItems = document.querySelectorAll('.gallery-item');
    let currentIndex = 0;

    function openLightbox(index) {
      currentIndex = index;
      const img = galleryItems[index].querySelector('img');
      lightboxImg.src = img.src;
      lightboxImg.alt = img.alt;
      lightbox.classList.add('active');
      document.body.style.overflow = 'hidden';
    }

    function closeLightbox() {
      lightbox.classList.remove('active');
      document.body.style.overflow = '';
    }

    function navigateLightbox(direction) {
      currentIndex += direction;
      if (currentIndex < 0) currentIndex = galleryItems.length - 1;
      if (currentIndex >= galleryItems.length) currentIndex = 0;
      const img = galleryItems[currentIndex].querySelector('img');
      lightboxImg.src = img.src;
      lightboxImg.alt = img.alt;
    }

    galleryItems.forEach((item, index) => {
      item.addEventListener('click', () => openLightbox(index));
    });

    closeBtn?.addEventListener('click', closeLightbox);
    prevBtn?.addEventListener('click', () => navigateLightbox(-1));
    nextBtn?.addEventListener('click', () => navigateLightbox(1));

    lightbox.addEventListener('click', (e) => {
      if (e.target === lightbox) closeLightbox();
    });

    document.addEventListener('keydown', (e) => {
      if (!lightbox.classList.contains('active')) return;
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') navigateLightbox(-1);
      if (e.key === 'ArrowRight') navigateLightbox(1);
    });

    // Touch swipe for lightbox
    let touchStartX = 0;
    lightbox.addEventListener('touchstart', (e) => {
      touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });

    lightbox.addEventListener('touchend', (e) => {
      const diff = touchStartX - e.changedTouches[0].screenX;
      if (Math.abs(diff) > 50) {
        navigateLightbox(diff > 0 ? 1 : -1);
      }
    }, { passive: true });
  }

  // Contact form (Web3Forms)
  const contactForm = document.getElementById('contact-form');
  if (contactForm) {
    contactForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = contactForm.querySelector('button[type="submit"]');
      const status = document.getElementById('form-status');
      const originalText = btn.textContent;

      btn.textContent = 'Sending...';
      btn.disabled = true;

      try {
        const formData = new FormData(contactForm);
        const response = await fetch('https://api.web3forms.com/submit', {
          method: 'POST',
          body: formData
        });
        const data = await response.json();

        if (data.success) {
          status.textContent = 'Thank you! Your message has been sent. We\'ll get back to you shortly.';
          status.className = 'form-status success';
          contactForm.reset();
        } else {
          throw new Error(data.message || 'Something went wrong');
        }
      } catch (err) {
        status.textContent = 'Oops! Something went wrong. Please call us at (412) 757-2301.';
        status.className = 'form-status error';
      }

      btn.textContent = originalText;
      btn.disabled = false;
    });
  }

  // Active nav link highlighting
  const path = window.location.pathname.replace(/\/index\.html$/, '/').replace(/\/$/, '') || '/';
  document.querySelectorAll('.nav-menu a').forEach(link => {
    const href = link.getAttribute('href');
    if (!href || href === '#') return;
    const linkPath = href.split('#')[0].replace(/\/$/, '') || '/';
    if (linkPath === path) {
      link.classList.add('active');
    }
  });

  // Header scroll effect
  const header = document.querySelector('.header');
  let lastScroll = 0;
  window.addEventListener('scroll', () => {
    const currentScroll = window.pageYOffset;
    if (currentScroll > 100) {
      header?.classList.add('scrolled');
    } else {
      header?.classList.remove('scrolled');
    }
    lastScroll = currentScroll;
  }, { passive: true });

  // Dynamic Google Reviews
  const reviewsGrid = document.getElementById('reviews-grid');
  if (reviewsGrid) {
    fetch('/data/reviews.json')
      .then(res => {
        if (!res.ok) throw new Error(res.status);
        return res.json();
      })
      .then(data => {
        if (!data.reviews || data.reviews.length === 0) return;

        reviewsGrid.innerHTML = data.reviews.map(review => {
          const initials = getInitials(review.authorName);
          const stars = '<i class="fas fa-star"></i>'.repeat(5);
          const text = escapeHtml(review.text)
            .split(/\n\n+/)
            .map(p => `<p>${p.trim()}</p>`)
            .join('');

          return `<div class="testimonial-card">
            <div class="testimonial-header">
              <div class="testimonial-avatar">${initials}</div>
              <div class="testimonial-meta">
                <h4>${escapeHtml(review.authorName)}</h4>
                <div class="testimonial-stars">${stars}</div>
              </div>
            </div>
            <div class="testimonial-text">${text}</div>
          </div>`;
        }).join('');

        injectReviewSchema(data);
      })
      .catch(err => console.error('Failed to load reviews:', err));
  }

  function injectReviewSchema(data) {
    const count = data.reviews.length.toString();
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'HVACBusiness',
      '@id': 'https://completehomecomfortpgh.com/#organization',
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: '5.0',
        bestRating: '5',
        worstRating: '1',
        ratingCount: count,
        reviewCount: count
      },
      review: data.reviews.map(r => ({
        '@type': 'Review',
        author: { '@type': 'Person', name: r.authorName },
        reviewRating: { '@type': 'Rating', ratingValue: '5', bestRating: '5' },
        reviewBody: r.text
      }))
    };
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(schema);
    document.head.appendChild(script);
  }

  function getInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

});
