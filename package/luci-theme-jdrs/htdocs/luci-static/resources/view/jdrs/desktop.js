'use strict';
'require view';
'require ui';
'require poll';
'require view.jdrs.data as D';

/*
 * JDRS 手机桌面 v1.6
 *   待机主页：大时钟 + 日期/在线数 + 底部四个常用图标（dock）
 *   上滑 → 磨砂抽屉：应用图标网格 + 搜索
 *   整理：长按 520ms → 拖动排序 / 拖进 dock 换位 / ✕ 隐藏 / 已隐藏可恢复
 *   布局全部落 localStorage，刷新与重启都在
 */

var LS_GRID = 'jdrs.grid.v1';
var LS_DOCK = 'jdrs.dock.v1';
var LS_HIDE = 'jdrs.hide.v1';
var DOCK_MAX = 4;

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

function childKeys(node) {
	var out = [];
	Array.prototype.forEach.call(node.children, function(el) {
		var k = el.getAttribute && el.getAttribute('data-key');
		if (k) out.push(k);
	});
	return out;
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

	/* ---------- 本地存储 ---------- */

	readLS: function(k) {
		try {
			var v = JSON.parse(localStorage.getItem(k) || 'null');
			return Array.isArray(v) ? v : null;
		}
		catch (e) { return null; }
	},

	writeLS: function(k, arr) {
		try { localStorage.setItem(k, JSON.stringify(arr)); }
		catch (e) {}
	},

	/* ---------- 布局计算 ---------- */

	defaultDock: function() {
		var self = this;
		var prefer = ['admin/status/overview', 'admin/network/network', 'admin/network/wireless', 'admin/system/system'];
		var keys = [];

		prefer.forEach(function(k) {
			if (self.byKey[k] && keys.indexOf(k) < 0) keys.push(k);
		});
		this.all.forEach(function(it) {
			if (keys.length < DOCK_MAX && keys.indexOf(it.key) < 0 && self.hidden.indexOf(it.key) < 0)
				keys.push(it.key);
		});
		return keys.slice(0, DOCK_MAX);
	},

	computeLists: function() {
		var self = this;
		var inDock = {};
		this.dockKeys.forEach(function(k) { inDock[k] = 1; });

		var rest = this.all.filter(function(it) {
			return !inDock[it.key] && self.hidden.indexOf(it.key) < 0;
		});

		var saved = this.readLS(LS_GRID) || [];
		var byKey = {}, out = [];
		rest.forEach(function(it) { byKey[it.key] = it; });
		saved.forEach(function(k) {
			if (byKey[k]) { out.push(byKey[k]); delete byKey[k]; }
		});
		rest.forEach(function(it) {
			if (byKey[it.key]) out.push(it);
		});

		this.gridList = out;
		this.dockList = this.dockKeys.map(function(k) { return self.byKey[k]; }).filter(Boolean);
	},

	/* ---------- 渲染 ---------- */

	build: function(tree) {
		var self = this;
		this.guard = 0;
		this.online = 0;
		this.edit = false;
		this.query = '';
		this.inHiddenPane = false;

		this.all = this.collect(tree);
		var byKey = {};
		this.all.forEach(function(it) { byKey[it.key] = it; });
		this.byKey = byKey;

		this.hidden = (this.readLS(LS_HIDE) || []).filter(function(k) { return byKey[k]; });

		var savedDock = (this.readLS(LS_DOCK) || []).filter(function(k) {
			return byKey[k] && self.hidden.indexOf(k) < 0;
		});
		this.dockKeys = savedDock.length ? savedDock.slice(0, DOCK_MAX) : this.defaultDock();

		this.computeLists();

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
		dock.appendChild(dockGrid);
		dock.appendChild(make('d-hint', '<span class="arw">︿</span>上滑打开应用 · 长按图标整理'));

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
		var dedit = make('d-dclose d-dbtn', '整理');
		var dhide = make('d-dclose d-dbtn d-dhidden', '已隐藏 0');
		var dreset = make('d-dclose d-dbtn d-dreset', '重置');
		dhide.style.display = 'none';
		dreset.style.display = 'none';
		dhead.appendChild(make('d-dtitle', '应用'));
		dhead.appendChild(make('d-flex'));
		dhead.appendChild(dhide);
		dhead.appendChild(dedit);
		dhead.appendChild(dreset);
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

		var hpane = make('d-hpane');
		hpane.style.display = 'none';
		drawer.appendChild(hpane);

		root.appendChild(drawer);

		var scrim = make('d-scrim');
		root.appendChild(scrim);

		this.root = root;
		this.home = home;
		this.drawer = drawer;
		this.scrim = scrim;
		this.grid = grid;
		this.dockGrid = dockGrid;
		this.editBtn = dedit;
		this.hideBtn = dhide;
		this.resetBtn = dreset;
		this.hpane = hpane;
		this.searchBox = search;

		this.refreshHiddenBtn();
		this.renderDock();
		this.renderGrid();

		input.addEventListener('input', function() {
			self.query = input.value;
			if (self.edit) self.exitEdit();
			self.renderGrid();
		});

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

		/* ---- 负载 / 在线设备 ---- */
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
		this.bindReorder(grid);
		this.bindReorder(dockGrid);

		dedit.addEventListener('click', function() {
			if (self.edit) self.exitEdit();
			else self.enterEdit();
		});

		dhide.addEventListener('click', function() { self.toggleHiddenPane(); });

		dreset.addEventListener('click', function() {
			if (!confirm('恢复默认布局（顺序、dock、隐藏全部还原）？')) return;
			try {
				localStorage.removeItem(LS_GRID);
				localStorage.removeItem(LS_DOCK);
				localStorage.removeItem(LS_HIDE);
			} catch (e) {}
			location.reload();
		});

		dclose.addEventListener('click', function() { self.close(); });
		scrim.addEventListener('click', function() { self.close(); });

		root.addEventListener('pointerdown', function(ev) {
			if (!self.edit) return;
			if (ev.target.closest('.d-tile') || ev.target.closest('.d-dhead') || ev.target.closest('.d-search'))
				return;
			self.exitEdit();
		});

		return root;
	},

	renderDock: function() {
		var self = this;
		this.dockGrid.innerHTML = '';
		this.dockList.forEach(function(it) {
			self.dockGrid.appendChild(self.tile(it, true));
		});
		if (!this.dockList.length)
			this.dockGrid.appendChild(make('d-empty dock-empty', '把图标拖到这里'));
	},

	renderGrid: function() {
		var self = this;
		var q = (this.query || '').trim().toLowerCase();
		this.grid.innerHTML = '';

		var shown = 0;
		this.gridList.forEach(function(it) {
			if (q && it.title.toLowerCase().indexOf(q) < 0 && it.key.toLowerCase().indexOf(q) < 0)
				return;
			self.grid.appendChild(self.tile(it, false));
			shown++;
		});

		if (!shown)
			this.grid.appendChild(make('d-empty', q ? '没有匹配的应用' : '图标都在 dock 里了'));
	},

	tile: function(it, isDock) {
		var self = this;
		var tile = make('d-tile' + (isDock ? ' dock' : ''));
		tile.setAttribute('data-key', it.key);

		var ic = make('d-ic', iconSvg(it.icon));
		ic.setAttribute('style', tintStyle(it.group));
		tile.appendChild(ic);
		tile.appendChild(make('d-tx', it.title));

		if (this.edit) {
			var x = make('d-x', '×');
			x.addEventListener('pointerdown', function(ev) { ev.stopPropagation(); });
			x.addEventListener('click', function(ev) {
				ev.stopPropagation();
				ev.preventDefault();
				self.hideItem(it.key);
			});
			tile.appendChild(x);
		}

		tile.addEventListener('click', function(ev) {
			if (self.edit) { ev.preventDefault(); return; }
			if (Date.now() < self.guard) { ev.preventDefault(); return; }
			location.href = it.url;
		});

		return tile;
	},

	/* ---------- 隐藏 / 恢复 ---------- */

	refreshHiddenBtn: function() {
		if (this.hidden.length) {
			this.hideBtn.style.display = '';
			this.hideBtn.textContent = '已隐藏 %d'.format(this.hidden.length);
		}
		else {
			this.hideBtn.style.display = 'none';
		}
	},

	hideItem: function(key) {
		if (this.hidden.indexOf(key) < 0) this.hidden.push(key);
		this.writeLS(LS_HIDE, this.hidden);

		var di = this.dockKeys.indexOf(key);
		if (di >= 0) {
			this.dockKeys.splice(di, 1);
			this.writeLS(LS_DOCK, this.dockKeys);
		}

		this.computeLists();
		this.renderDock();
		this.renderGrid();
		this.refreshHiddenBtn();
		if (this.inHiddenPane) this.renderHiddenPane();
		if (navigator.vibrate) navigator.vibrate(8);
	},

	restoreItem: function(key) {
		var i = this.hidden.indexOf(key);
		if (i < 0) return;
		this.hidden.splice(i, 1);
		this.writeLS(LS_HIDE, this.hidden);

		this.computeLists();
		this.renderDock();
		this.renderGrid();
		this.refreshHiddenBtn();
		if (this.inHiddenPane) this.renderHiddenPane();
	},

	toggleHiddenPane: function() {
		if (this.inHiddenPane) {
			this.inHiddenPane = false;
			this.hpane.style.display = 'none';
			this.grid.style.display = '';
			this.searchBox.style.display = '';
			this.hideBtn.textContent = '已隐藏 %d'.format(this.hidden.length);
			return;
		}
		if (!this.hidden.length) return;
		this.inHiddenPane = true;
		this.grid.style.display = 'none';
		this.searchBox.style.display = 'none';
		this.hpane.style.display = '';
		this.hideBtn.textContent = '返回';
		this.renderHiddenPane();
	},

	renderHiddenPane: function() {
		var self = this;
		this.hpane.innerHTML = '';

		var bar = make('d-hbar');
		var all = make('d-hbtn', '全部恢复');
		all.addEventListener('click', function() {
			self.hidden = [];
			self.writeLS(LS_HIDE, self.hidden);
			self.computeLists();
			self.renderDock();
			self.renderGrid();
			self.refreshHiddenBtn();
			self.toggleHiddenPane();
		});
		bar.appendChild(make('d-htip', '已隐藏的图标不在桌面上'));
		bar.appendChild(make('d-flex'));
		bar.appendChild(all);
		this.hpane.appendChild(bar);

		var list = make('d-hlist');
		this.hidden.forEach(function(k) {
			var it = self.byKey[k];
			if (!it) return;
			var row = make('d-hrow');
			var ic = make('d-hic', iconSvg(it.icon));
			ic.setAttribute('style', tintStyle(it.group));
			row.appendChild(ic);
			row.appendChild(make('d-htx', it.title));
			row.appendChild(make('d-flex'));
			var btn = make('d-hbtn', '恢复');
			btn.addEventListener('click', function() { self.restoreItem(k); });
			row.appendChild(btn);
			list.appendChild(row);
		});
		this.hpane.appendChild(list);
	},

	/* ---------- 整理态 ---------- */

	enterEdit: function() {
		if (this.edit) return;
		this.edit = true;
		this.root.classList.add('edit');
		this.editBtn.textContent = '完成';
		this.resetBtn.style.display = '';

		if (this.inHiddenPane) this.toggleHiddenPane();

		if (this.query) {
			this.query = '';
			var si = this.searchBox.querySelector('input');
			if (si) si.value = '';
		}

		this.renderGrid();
		this.renderDock();
		if (navigator.vibrate) navigator.vibrate(12);
	},

	exitEdit: function() {
		if (!this.edit) return;
		this.edit = false;
		this.root.classList.remove('edit');
		this.editBtn.textContent = '整理';
		this.resetBtn.style.display = 'none';
		this.finishDrag();
	},

	/* 把 DOM 顺序写回存储（含 dock 上限裁剪） */
	finishDrag: function() {
		var dockKeys = childKeys(this.dockGrid);
		var gridKeys = childKeys(this.grid);

		if (dockKeys.length > DOCK_MAX) {
			var extra = dockKeys.slice(DOCK_MAX);
			dockKeys = dockKeys.slice(0, DOCK_MAX);
			gridKeys = extra.concat(gridKeys);
		}

		this.dockKeys = dockKeys;
		this.writeLS(LS_DOCK, dockKeys);
		this.writeLS(LS_GRID, gridKeys);

		this.computeLists();
		this.renderDock();
		this.renderGrid();
	},

	/* 长按 520ms 进整理；整理态下拖动：同容器换位 + 跨 dock/网格搬运 */
	bindReorder: function(container) {
		var self = this, timer = null, sx = 0, sy = 0;

		container.addEventListener('pointerdown', function(ev) {
			var tile = ev.target.closest('.d-tile');
			if (!tile || tile.parentNode !== container) return;

			if (!self.edit) {
				sx = ev.clientX; sy = ev.clientY;
				timer = setTimeout(function() {
					timer = null;
					self.enterEdit();
				}, 520);
				return;
			}

			self.dragTile = tile;
			tile.classList.add('lift');
			try { tile.setPointerCapture(ev.pointerId); } catch (e) {}
			ev.preventDefault();
		});

		container.addEventListener('pointermove', function(ev) {
			if (timer && (Math.abs(ev.clientX - sx) > 10 || Math.abs(ev.clientY - sy) > 10)) {
				clearTimeout(timer);
				timer = null;
			}

			var tile = self.dragTile;
			if (!tile) return;

			var el = document.elementFromPoint(ev.clientX, ev.clientY);
			if (!el) return;

			var overTile = el.closest ? el.closest('.d-tile') : null;
			var target = overTile ? overTile.parentNode : null;

			if (!target) {
				if (el.closest && el.closest('.d-dockgrid')) target = self.dockGrid;
				else if (el.closest && el.closest('.d-grid')) target = self.grid;
			}
			if (!target) return;

			if (target !== tile.parentNode) {
				target.appendChild(tile);
				ev.preventDefault();
				return;
			}

			if (overTile && overTile !== tile) {
				var r = overTile.getBoundingClientRect();
				var after = ev.clientX > r.left + r.width / 2;
				container.insertBefore(tile, after ? overTile.nextSibling : overTile);
				ev.preventDefault();
			}
		});

		var end = function() {
			if (timer) { clearTimeout(timer); timer = null; }
			var tile = self.dragTile;
			if (!tile) return;
			tile.classList.remove('lift');
			self.dragTile = null;
			self.finishDrag();
		};

		container.addEventListener('pointerup', end);
		container.addEventListener('pointercancel', end);
	},

	/* ---------- 菜单收集 ---------- */

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
		var self = this;
		var key = {};
		this.dockList.forEach(function(it) { key[it.key] = 1; });
		return this.all.filter(function(it) { return key[it.key]; });
	},

	open: function() {
		this.drawer.classList.add('open');
		this.scrim.classList.add('open');
		this.home.classList.add('dim');
		if (navigator.vibrate) navigator.vibrate(8);
	},

	close: function() {
		if (this.edit) this.exitEdit();
		this.drawer.classList.remove('open');
		this.scrim.classList.remove('open');
		this.home.classList.remove('dim');
		this.guard = Date.now() + 320;
		var input = this.drawer.querySelector('input');
		if (input && input.value) {
			input.value = '';
			this.query = '';
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
		drawer.addEventListener('pointerup', function() {
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
