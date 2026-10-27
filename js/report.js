window.buildFullDataReport = function () {
  const now = new Date();
  const line = '='.repeat(58);
  const thin = '-'.repeat(58);
  const header = `${line}\nPERSONAL TRAINING - FULL DATA EXPORT\nGenerated: ${now.toLocaleString()}\n${line}\n\n`;

  let totalSessions = 0, totalWorkouts = 0, totalProgress = 0;
  let body = '';

  if (APP_STATE.clients.length === 0) body = '(No clients in database)\n';

  APP_STATE.clients.forEach(c => {
    const rate = getRate(c.id);
    body += `\n[CLIENT] ${c.name}\n`;
    body += `   Login ID: ${c.login_id}\n`;
    body += `   Password: ${c.password_hint}\n`;
    body += `   Email:    ${c.email || '-'}\n`;
    body += `   Phone:    ${c.phone || '-'}\n`;
    body += `   Rate:     ${APP_CONFIG.CURRENCY} ${rate}/session\n`;
    body += `   Status:   ${c.active ? 'Active' : 'CLOSED'}\n`;

    const sessionsList = [];
    Object.keys(APP_STATE.sessionCache).forEach(k => {
      if (!k.startsWith(c.id + '-')) return;
      APP_STATE.sessionCache[k].forEach(s => {
        const [yy, mm] = k.substring(c.id.length + 1).split('-').map(Number);
        sessionsList.push(formatDateISO(yy, mm, s.day));
      });
    });
    sessionsList.sort();
    totalSessions += sessionsList.length;
    body += `\n   -- SESSIONS (checked days) --\n`;
    body += sessionsList.length > 0 ? `   ${sessionsList.join(', ')}\n` : `   (none)\n`;

    const dts = clientMapGet(APP_STATE.dailyTimesCache, c.id) || [];
    if (dts.length > 0) {
      body += `\n   -- DAILY TIMES --\n`;
      dts.sort((a, b) => a.day_date.localeCompare(b.day_date)).forEach(d => {
        body += `   ${d.day_date} @ ${formatClassTime12(d.class_time)}${d.note ? ' - ' + d.note : ''}\n`;
      });
    }

    body += `\n   -- WORKOUT LOGS (exercises done per day) --\n`;
    const dateKeys = Object.keys(APP_STATE.workoutLogsCache)
      .filter(k => k.startsWith(c.id + '-'))
      .map(k => k.substring(c.id.length + 1))
      .sort();
    if (dateKeys.length === 0) {
      body += `   (none)\n`;
    } else {
      dateKeys.forEach(ds => {
        const logs = APP_STATE.workoutLogsCache[`${c.id}-${ds}`] || [];
        if (logs.length === 0) return;
        totalWorkouts += logs.length;
        const [yy, mm, dd] = ds.split('-').map(Number);
        const dayLabel = new Date(yy, mm - 1, dd).toLocaleDateString('en-US',
          { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
        body += `\n   * ${dayLabel}\n`;
        logs.forEach(log => {
          const name = getWorkoutDisplayName(log);
          const parts = [];
          if (log.sets_done) parts.push(`${log.sets_done} sets`);
          if (log.reps_done) parts.push(`${log.reps_done} reps`);
          if (log.weight_done) parts.push(`@ ${log.weight_done}`);
          if (log.rest_done) parts.push(`rest ${log.rest_done}`);
          body += `      - ${name}${parts.length ? ' - ' + parts.join(' x ') : ''}`;
          if (log.notes) body += `\n        Notes: ${log.notes}`;
          body += `\n`;
        });
      });
    }

    const prog = (clientMapGet(APP_STATE.progressEntries, c.id) || [])
      .slice().sort((a, b) => (b.entry_date || '').localeCompare(a.entry_date || ''));
    totalProgress += prog.length;
    body += `\n   -- PROGRESS ENTRIES --\n`;
    if (prog.length === 0) body += `   (none)\n`;
    else prog.forEach(p => {
      body += `   * ${p.entry_date} (${p.added_by === 'admin' ? 'Admin' : 'Client'})\n`;
      const l = [];
      if (p.weight_kg) l.push(`Weight: ${p.weight_kg} kg`);
      if (p.body_fat_pct) l.push(`Body Fat: ${p.body_fat_pct}%`);
      if (p.chest_cm) l.push(`Chest: ${p.chest_cm} cm`);
      if (p.waist_cm) l.push(`Waist: ${p.waist_cm} cm`);
      if (p.hips_cm) l.push(`Hips: ${p.hips_cm} cm`);
      if (p.arms_cm) l.push(`Arms: ${p.arms_cm} cm`);
      if (p.thighs_cm) l.push(`Thighs: ${p.thighs_cm} cm`);
      if (l.length) body += `        ${l.join(' | ')}\n`;
      if (p.notes) body += `        Notes: ${p.notes}\n`;
      if (p.photo_url) body += `        Photo: ${p.photo_url}\n`;
    });

    const prof = clientMapGet(APP_STATE.clientProfiles, c.id) || {};
    body += `\n   -- PROFILE --\n`;
    body += `   Height: ${prof.height_cm ? prof.height_cm + ' cm' : '-'} | Gender: ${prof.gender || '-'}\n`;
    body += `   Birth: ${prof.birth_date || '-'}\n`;
    body += `   Goal: ${prof.goal || '-'}\n`;
    body += `   Medical: ${prof.medical_notes || '-'}\n`;
    body += `   Emergency: ${prof.emergency_contact || '-'}\n`;

    const assigned = clientMapGet(APP_STATE.clientExercisesCache, c.id) || [];
    body += `\n   -- TEMPLATE EXERCISES --\n`;
    if (assigned.length === 0) body += `   (none)\n`;
    else assigned.forEach(a => {
      const ex = getExercise(a.exercise_id);
      if (!ex) return;
      body += `   - ${ex.name} - ${a.custom_sets || ex.default_sets || '-'} x ${a.custom_reps || ex.default_reps || '-'}`;
      const w = a.custom_weight || ex.default_weight; if (w) body += ` @ ${w}`;
      body += `\n`;
    });

    const pa = APP_STATE.profileApprovals.filter(x => sameId(x.client_id, c.id));
    const pga = APP_STATE.progressApprovals.filter(x => sameId(x.client_id, c.id));
    if (pa.length + pga.length > 0) {
      body += `\n   -- APPROVALS --\n`;
      pa.forEach(a => { body += `   [Profile / ${a.status}] submitted ${new Date(a.submitted_at).toLocaleString()}${a.admin_note ? ' - ' + a.admin_note : ''}\n`; });
      pga.forEach(a => { body += `   [Progress ${a.action} / ${a.status}] submitted ${new Date(a.submitted_at).toLocaleString()}${a.admin_note ? ' - ' + a.admin_note : ''}\n`; });
    }

    body += `\n${thin}\n`;
  });

  const footer = `\n${line}\nTOTALS\n   Clients:   ${APP_STATE.clients.length}\n   Sessions:  ${totalSessions}\n   Workouts:  ${totalWorkouts} exercise logs\n   Progress:  ${totalProgress} entries\n${line}\n`;
  return header + body + footer;
};