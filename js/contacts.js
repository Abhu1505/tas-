window.supportsContactPicker = function () {
  return 'contacts' in navigator && 'ContactsManager' in window;
};

window.pickFromContacts = async function () {
  if (!supportsContactPicker()) {
    showStatus($('createClientStatus'), '⚠️ Not supported.', 'error');
    return;
  }
  try {
    const contacts = await navigator.contacts.select(['name', 'tel'], { multiple: false });
    if (!contacts || contacts.length === 0) return;
    const c = contacts[0];
    const name = (c.name && c.name[0]) || '';
    let phone = (c.tel && c.tel[0]) || '';
    phone = phone.replace(/[\s\-\(\)\.]/g, '').replace(/^\+/, '');
    if (name) $('newClientName').value = name;
    if (phone) $('newClientPhone').value = phone;
    showStatus($('createClientStatus'), `✅ Imported: ${name || '(no name)'} · ${phone || '(no phone)'}`, 'success');
    setTimeout(() => clearStatus($('createClientStatus')), 3000);
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    showStatus($('createClientStatus'), '⚠️ ' + err.message, 'error');
  }
};

window.initContactPicker = function () {
  const btn = $('pickContactBtn');
  const hint = $('contactHint');
  if (!btn || !hint) return;
  if (supportsContactPicker()) {
    btn.classList.remove('hidden');
    hint.classList.add('hidden');
  } else {
    btn.classList.add('hidden');
    if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) hint.classList.remove('hidden');
  }
};