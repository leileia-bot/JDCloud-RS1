'use strict';
'require ui';
'require view';

return view.extend({
	render() {
		document.body.classList.add('jdrs-login');
		const form = document.querySelector('form');
		const btn = document.querySelector('button');

		const dlg = ui.showModal(
			_('Authorization Required'),
			Array.from(document.querySelectorAll('section > *')),
			'login'
		);

		const clock = E('div', { class: 'jdrs-login-head' }, [
			E('div', { class: 'jdrs-login-clock' }, '--:--'),
			E('div', { class: 'jdrs-login-sub' }, 'Hello · JDRS')
		]);
		dlg.insertBefore(clock, dlg.firstChild);

		const tickLogin = () => {
			const d = new Date();
			const pad = (n) => (n < 10 ? '0' : '') + n;
			clock.firstChild.textContent = pad(d.getHours()) + ':' + pad(d.getMinutes());
			clock.lastChild.textContent = ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'][d.getDay()]
				+ ' · ' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
		};
		tickLogin();
		setInterval(tickLogin, 30000);

		form.addEventListener('keypress', (ev) => {
			if (ev.key === 'Enter')
				btn.click();
		});

		btn.addEventListener('click', () => {
			dlg.querySelectorAll('*').forEach((node) => {
				node.style.display = 'none';
			});
			dlg.appendChild(E('div', {
				class: 'spinning'
			}, _('Logging in…')));

			form.submit();
		});

		document.querySelector('input[type="password"]').focus();

		return '';
	},

	addFooter() {},

});