(function (window) {
  'use strict';

  function buildImageUrls(id) {
    if (!id) return [];
    return [
      `https://lh3.googleusercontent.com/d/${id}=w2400`,
      `https://drive.google.com/thumbnail?id=${id}&sz=w2400`,
      `https://drive.google.com/uc?export=view&id=${id}`
    ];
  }

  function attachDriveFallback(img, id, opts) {
    opts = opts || {};
    const urls = buildImageUrls(id);
    if (!urls.length) return;
    let ui = 0;
    const parent = img.parentNode;
    const hideFallback = opts.hideFallback === true;

    function tryNext() {
      ui++;
      if (ui < urls.length) {
        img.src = urls[ui];
      } else {
        img.style.display = 'none';
        if (hideFallback) return;
        const fb = document.createElement('a');
        fb.className = 'gdrive-fallback';
        fb.href = `https://drive.google.com/file/d/${id}/view`;
        fb.target = '_blank';
        fb.rel = 'noopener noreferrer';
        fb.innerHTML = `<div style="font-size:2rem;line-height:1;">📷</div><div style="font-size:0.7rem;font-weight:700;margin-top:0.2rem;">Open Photo</div>`;
        fb.style.cssText = `display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;height:100%;min-height:80px;padding:0.6rem;background:linear-gradient(135deg,#e3f2fd,#bbdefb);color:#0d47a1;text-decoration:none;border-radius:0.8rem;border:2px dashed #64b5f6;`;
        if (parent) parent.appendChild(fb);
      }
    }

    img.addEventListener('error', tryNext);
    img.addEventListener('load', function () { img.removeEventListener('error', tryNext); });
    img.src = urls[0];
  }

  function initDriveImages(root) {
    root = root || document;
    root.querySelectorAll('img[data-gdrive-id]').forEach(function (img) {
      if (img.dataset.gdriveLoaded === '1') return;
      img.dataset.gdriveLoaded = '1';
      const id = img.dataset.gdriveId;
      const hideFb = img.dataset.gdriveHideFallback === '1';
      if (id) attachDriveFallback(img, id, { hideFallback: hideFb });
    });
  }

  window.DriveImages = { buildImageUrls, attachDriveFallback, init: initDriveImages };

  function boot() { initDriveImages(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);