window.renderLibrary = function () {
  if (APP_STATE.exercises.length === 0) {
    $('libraryList').innerHTML = `<div class="empty-message">No exercises.</div>`;
    return;
  }
  let html = '';
  APP_STATE.exercises.forEach(ex => {
    html += `<div class="library-row"><div style="flex:1;min-width:0;"><div class="library-row-name">${escapeHtml(ex.name)}</div>
      <div class="library-row-meta">${ex.category ? escapeHtml(ex.category) + ' · ' : ''}${ex.default_sets || '-'} × ${ex.default_reps || '-'}</div></div>
      <div class="library-row-actions"><button class="btn-secondary btn-small edit-ex-btn" data-id="${ex.id}">✏️</button><button class="btn-danger-small btn-small del-ex-btn" data-id="${ex.id}">🗑️</button></div>
    </div>`;
  });
  $('libraryList').innerHTML = html;
  document.querySelectorAll('.edit-ex-btn').forEach(b =>
    b.addEventListener('click', () => openExerciseModal(b.dataset.id)));
  document.querySelectorAll('.del-ex-btn').forEach(b =>
    b.addEventListener('click', async () => {
      const ex = getExercise(b.dataset.id);
      const ok = await uiConfirm({
        title: 'Delete Exercise',
        message: `Delete "${ex ? ex.name : 'this exercise'}" from the library? This cannot be undone.`,
        confirmText: '🗑️ Delete', danger: true
      });
      if (!ok) return;
      try {
        const { error } = await APP_STATE.supabaseClient.from('exercises').delete().eq('id', b.dataset.id);
        if (error) throw error;
        APP_STATE.exercises = APP_STATE.exercises.filter(e => !sameId(e.id, b.dataset.id));
        renderLibrary();
        showStatus($('libraryStatus'), '✅ Exercise deleted.', 'success');
      } catch (err) {
        showStatus($('libraryStatus'), '❌ ' + err.message, 'error');
      }
    }));
};

window.openExerciseModal = function (id) {
  $('editExerciseId').value = id || '';
  if (id) {
    const ex = getExercise(id); if (!ex) return;
    $('exerciseModalTitle').textContent = '✏️ Edit';
    $('exName').value = ex.name || '';
    $('exCategory').value = ex.category || '';
    $('exMuscle').value = ex.muscle_group || '';
    $('exSets').value = ex.default_sets || '';
    $('exReps').value = ex.default_reps || '';
    $('exWeight').value = ex.default_weight || '';
    $('exRest').value = ex.default_rest || '';
    $('exNotes').value = ex.notes || '';
  } else {
    $('exerciseModalTitle').textContent = '➕ Add';
    ['exName', 'exCategory', 'exMuscle', 'exSets', 'exReps', 'exWeight', 'exRest', 'exNotes'].forEach(i => $(i).value = '');
  }
  $('exerciseModal').classList.remove('hidden');
  clearStatus($('exerciseModalStatus'));
};