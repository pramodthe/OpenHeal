document.getElementById('task-form')?.addEventListener('submit', (e) => {
  e.preventDefault();
  // BUG: intentionally does not persist tasks — Explorer should flag broken-submit
  const marker = document.querySelector('.openheal-bug');
  if (marker) marker.hidden = false;
});
