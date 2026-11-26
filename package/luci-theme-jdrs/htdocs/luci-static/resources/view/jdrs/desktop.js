'use strict';
'require view';
'require ui';
'require poll';
'require view.jdrs.data as D';

/*
 * JDRS 手机桌面 v1.4（对齐参考视频的三层结构）
 *   待机主页：大时钟 + 日期/在线数 + 底部四个常用图标
 *   上滑 → 磨砂抽屉：应用图标网格 + 搜索
 */

var TINTS = {
	status:   ['#4FB3FF', '#1B7FD6'],
	network:  ['#54E0B4', '#1E9E77'],
	services: ['#A98BFF', '#6A4FD8'],
	system:   ['#FFC05A', '#D98614'],
	unknown:  ['#8FA6C4', '#4E6478']
};

var WEEK = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

function make(cls, html) {
	var n = document.createElement('div');
	if (cls) n.className = cls;
	if (html != null) n.innerHTML = html;
	return n;
}

function iconSvg(name) {
	var body = D.icons[name] || '<rect x="5" y="5" width="14" height="14" rx="3"/>';
	return '<svg viewBox="0 0 24 24" stroke="#fff" stroke-width="2" stroke-linecap="round" '
		+ 'stroke-linejoin="round" fill="none">' + body + '</svg>';
}

function pad2(n) {
	return (n < 10 ? '0' : '') + n;
}

function tintStyle(group) {
	var t = TINTS[group] || TINTS.unknown;
	return 'background:linear-gradient(155deg,' + t[0] + ',' + t[1] + ')';
}

return view.extend({
	load: function() {
		return ui.menu.load();
	},

	render: function(tree) {
		try {
			return this.build(tree);
		}
		catch (e) {
			var fb = make('jdrs-desk');
			fb.innerHTML = '<div style="padding:48px 24px;color:#dfe8f4">'
				+ '<div style="font-size:16px">桌面加载失败</div>'
				+ '<div style="font-size:12px;color:#7d8ba1;margin:10px 0 18px">'
				+ (e && e.message ? e.message : 'unknown') + '</div>'
				+ '<a style="color:#46d8ff" href="' + L.url('admin', 'status/overview') + '">返回状态总览</a></div>';
			return fb;
		}
	},

	build: function(tree) {
		var self = this;
		this.guard = 0;
		this.online = 0;
		this.items = this.collect(tree);

		var root = make('jdrs-desk');
		root.appendChild(make('d-wall'));

		/* ---- 主页 ---- */
		var home = make('d-home');

		var top = make('d-top');
		var host = make('d-host', (document.title.split('|')[0] || '').trim());
		var pill = make('d-pill', '在线 0');
		top.appendChild(host);
		top.appendChild(make('d-flex'));
		top.appendChild(pill);

		var clock = make('d-clock');
		clock.innerHTML = '<span class="h">--</span><span class="m">--</span><span class="s">00</span>';

		var dateRow = make('d-date', '--/--');
		var infoRow = make('d-info', '');

		var dock = make('d-dockwrap');
		var dockGrid = make('d-dockgrid');
		this.dockItems().forEach(function(it) {
			dockGrid.appendChild(self.tile(it, true));
		});
		dock.appendChild(dockGrid);
		dock.appendChild(make('d-hint', '<span class="arw">︿</span>上滑打开应用'));

		home.appendChild(top);
		home.appendChild(make('d-flex'));
		home.appendChild(clock);
		home.appendChild(dateRow);
		home.appendChild(infoRow);
		home.appendChild(make('d-flex'));
		home.appendChild(dock);
		root.appendChild(home);

		/* ---- 抽屉 ---- */
		var drawer = make('d-drawer');
		drawer.appendChild(make('d-dhandle'));

		var dhead = make('d-dhead');
		var dclose = make('d-dclose', '关闭');
		dhead.appendChild(make('d-dtitle', '应用'));
		dhead.appendChild(make('d-flex'));
		dhead.appendChild(dclose);
		drawer.appendChild(dhead);

		var search = make('d-search');
		var input = document.createElement('input');
		input.type = 'search';
		input.placeholder = '搜索应用';
		search.appendChild(input);
		drawer.appendChild(search);

		var grid = make('d-grid');
		drawer.appendChild(grid);
		root.appendChild(drawer);

		var scrim = make('d-scrim');
		root.appendChild(scrim);

		this.root = root;
		this.home = home;
		this.drawer = drawer;
		this.scrim = scrim;

		var paintGrid = function(kw) {
			var q = (kw || '').trim().toLowerCase();
			grid.innerHTML = '';
			var shown = 0;
			self.items.forEach(function(it) {
				if (q && it.title.toLowerCase().indexOf(q) < 0 && it.key.toLowerCase().indexOf(q) < 0)
					return;
				grid.appendChild(self.tile(it, false));
				shown++;
			});
			if (!shown) grid.appendChild(make('d-empty', '没有匹配的应用'));
		};
		input.addEventListener('input', function() { paintGrid(input.value); });
		paintGrid('');

		/* ---- 时钟 ---- */
		var tick = function() {
			var d = new Date();
			clock.children[0].textContent = d.getHours();
			clock.children[1].textContent = pad2(d.getMinutes());
			clock.children[2].textContent = pad2(d.getSeconds());
			dateRow.textContent = '%s/%s  %s'.format(pad2(d.getMonth() + 1), pad2(d.getDate()), WEEK[d.getDay()]);
		};
		tick();
		poll.add(tick, 30);

		/* ---- 负载 / 在线设备（取不到就不显示，不报错） ---- */
		L.rpc.declare({ object: 'luci', method: 'getHostUsage' })().then(function(load) {
			if (Array.isArray(load) && load.length)
				infoRow.textContent = '负载 ' + load.join(' · ');
		}).catch(function() {});

		L.rpc.declare({ object: 'luci-rpc', method: 'getWirelessClients' })().then(function(hosts) {
			if (hosts && typeof hosts == 'object') {
				self.online = Object.keys(hosts).length;
				pill.textContent = '在线 %d'.format(self.online);
			}
		}).catch(function() {});

		/* ---- 交互 ---- */
		this.bindSwipe(home, drawer);
		dclose.addEventListener('click', function() { self.close(); });
		scrim.addEventListener('click', function() { self.close(); });

		return root;
	},

	collect: function(tree) {
		var out = [];
		var secs = ui.menu.getChildren(tree);

		var push = function(node, secName) {
			var path = (node.action && node.action.path) ? node.action.path : (secName + '/' + node.name);
			var key = 'admin/' + path;
			var ic = D.menu[key] || D.menu['admin/' + secName] || 'service';
			out.push({
				key: key,
				title: _(node.title || node.name),
				icon: ic,
				group: D.groups[ic] || 'services',
				url: L.url('admin', path)
			});
		};

		secs.forEach(function(sec) {
			var kids = ui.menu.getChildren(sec);
			if (!kids.length) {
				if (sec.action && (sec.action.type == 'view' || sec.action.type == 'template'))
					push(sec, sec.name);
				return;
			}
			kids.forEach(function(k) { push(k, sec.name); });
		});

		return out;
	},

	dockItems: function() {
		var prefer = ['admin/status/overview', 'admin/network/network', 'admin/network/wireless', 'admin/system/system'];
		var byKey = {}, picked = [];
		this.items.forEach(function(it) { byKey[it.key] = it; });
		prefer.forEach(function(k) {
			if (byKey[k] && picked.length < 4) picked.push(byKey[k]);
		});
		this.items.forEach(function(it) {
			if (picked.length < 4 && picked.indexOf(it) < 0) picked.push(it);
		});
		return picked.slice(0, 4);
	},

	tile: function(it, isDock) {
		var tile = make('d-tile' + (isDock ? ' dock' : ''));
		var ic = make('d-ic', iconSvg(it.icon));
		ic.setAttribute('style', tintStyle(it.group));
		tile.appendChild(ic);
		tile.appendChild(make('d-tx', it.title));
		var self = this;
		tile.addEventListener('click', function(ev) {
			if (Date.now() < self.guard) { ev.preventDefault(); return; }
			location.href = it.url;
		});
		return tile;
	},

	open: function() {
		this.drawer.classList.add('open');
		this.scrim.classList.add('open');
		this.home.classList.add('dim');
		navigator.vibrate && navigator.vibrate(8);
	},

	close: function() {
		this.drawer.classList.remove('open');
		this.scrim.classList.remove('open');
		this.home.classList.remove('dim');
		this.guard = Date.now() + 320;
		var input = this.drawer.querySelector('input');
		if (input && input.value) {
			input.value = '';
			input.dispatchEvent(new Event('input'));
		}
	},

	bindSwipe: function(home, drawer) {
		var self = this;
		var active = false, moved = false, y0 = 0, dy = 0, t0 = 0;

		home.addEventListener('pointerdown', function(ev) {
			if (ev.target.closest('.d-tile')) return;
			active = true; moved = false; y0 = ev.clientY; dy = 0; t0 = Date.now();
		});

		home.addEventListener('pointermove', function(ev) {
			if (!active) return;
			dy = ev.clientY - y0;
			if (Math.abs(dy) > 8) moved = true;
			if (dy < 0) {
				var shift = Math.min(1, -dy / 170);
				drawer.classList.add('drag');
				drawer.style.transform = 'translateY(' + (100 - shift * 100) + '%)';
			}
		});

		home.addEventListener('pointerup', function() {
			if (!active) return;
			active = false;
			drawer.classList.remove('drag');
			drawer.style.transform = '';
			if (!moved) return;
			var v = dy / Math.max(1, Date.now() - t0);
			if (dy < -55 || (v < -0.35 && dy < -18)) self.open();
		else if (dy > 55) self.close();
		});

		home.addEventListener('pointercancel', function() {
			active = false;
			drawer.classList.remove('drag');
			drawer.style.transform = '';
		});

		var dStart = 0, dragging = false;
		drawer.addEventListener('pointerdown', function(ev) {
			if (ev.target.closest('input') || ev.target.closest('.d-tile')) return;
			dStart = ev.clientY; dragging = true;
		});
		drawer.addEventListener('pointermove', function(ev) {
			if (!dragging) return;
			var d = ev.clientY - dStart;
			if (d > 0) {
				drawer.classList.add('drag');
				drawer.style.transform = 'translateY(' + Math.min(100, d / 3.5) + '%)';
			}
		});
		drawer.addEventListener('pointerup', function(ev) {
			if (!dragging) return;
			dragging = false;
			var d = ev.clientY - dStart;
			drawer.classList.remove('drag');
			drawer.style.transform = '';
			if (d > 90) self.close();
		});
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
