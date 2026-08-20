(() => {
  'use strict';

  const tabs = [...document.querySelectorAll('[role="tab"][data-role]')];
  const panels = [...document.querySelectorAll('[data-role-panel]')];
  const status = document.querySelector('#app-status');

  const announce = (message) => {
    status.textContent = '';
    window.setTimeout(() => { status.textContent = message; }, 20);
  };

  const activateRole = (tab, moveFocus = false) => {
    tabs.forEach((item) => {
      const active = item === tab;
      item.setAttribute('aria-selected', String(active));
      item.tabIndex = active ? 0 : -1;
    });
    panels.forEach((panel) => { panel.hidden = panel.dataset.rolePanel !== tab.dataset.role; });
    if (moveFocus) tab.focus();
    announce(`${tab.textContent.trim()} review dashboard loaded. Synthetic data only.`);
    history.replaceState(null, '', `#${tab.dataset.role}-view`);
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activateRole(tab));
    tab.addEventListener('keydown', (event) => {
      let next = index;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      else return;
      event.preventDefault();
      activateRole(tabs[next], true);
    });
  });

  const activateHashRole = () => {
    const hashRole = location.hash.match(/^#(athlete|coach|admin|guardian)-view$/)?.[1];
    if (hashRole) activateRole(tabs.find((tab) => tab.dataset.role === hashRole));
  };
  activateHashRole();
  window.addEventListener('hashchange', activateHashRole);

  document.querySelectorAll('[data-dialog-open]').forEach((button) => {
    button.addEventListener('click', () => document.getElementById(button.dataset.dialogOpen)?.showModal());
  });

  document.querySelectorAll('dialog').forEach((dialog) => {
    dialog.addEventListener('click', (event) => {
      const bounds = dialog.getBoundingClientRect();
      const outside = event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
      if (outside) dialog.close('cancel');
    });
  });

  const validateDialog = (form, successMessage) => {
    const error = form.querySelector('.form-error');
    form.addEventListener('submit', (event) => {
      const submitter = event.submitter;
      if (submitter?.value === 'cancel') return;
      if (!form.checkValidity()) {
        event.preventDefault();
        error.textContent = 'Complete the required fields before continuing.';
        form.reportValidity();
        return;
      }
      event.preventDefault();
      error.textContent = '';
      form.closest('dialog').close();
      announce(successMessage);
      form.reset();
    });
  };
  validateDialog(document.querySelector('[data-checkin-form]'), 'Check-in saved in this review only. Your synthetic coach would be notified of any pain flag.');
  validateDialog(document.querySelector('[data-change-form]'), 'Workout change request sent for synthetic coach approval.');

  document.querySelectorAll('[data-mock-form]').forEach((form) => {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const message = form.querySelector('.form-message');
      if (!form.checkValidity()) {
        message.textContent = 'Complete the required fields.';
        form.reportValidity();
        return;
      }
      message.textContent = form.dataset.success;
      announce(form.dataset.success);
    });
  });

  document.querySelectorAll('[data-action-status]').forEach((button) => {
    button.addEventListener('click', () => announce(button.dataset.actionStatus));
  });

  document.querySelectorAll('[data-reserve]').forEach((button) => {
    button.addEventListener('click', () => {
      const message = button.parentElement.querySelector('.form-message');
      const reserved = button.getAttribute('aria-pressed') === 'true';
      button.setAttribute('aria-pressed', String(!reserved));
      button.textContent = reserved ? 'Reserve Saturday' : 'Cancel review reservation';
      message.textContent = reserved ? 'Review reservation canceled. No real session changed.' : 'Saturday reserved in this review only. No real seat was taken.';
      announce(message.textContent);
    });
  });
})();
