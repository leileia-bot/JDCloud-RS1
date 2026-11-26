'use strict';
'require view';
'require ui';
'require poll';
'require baseclass';
'require view.jdrs.data as D';

/*
 * JDRS 手机桌面（滑动桌面）
 * - 4 列应用网格，左右滑动翻页
 * - 长按进入编辑，拖动交换位置，顺序存 localStorage
 * - 上滑 / 底部按钮 → 磨砂抽屉，全部菜单 + 搜索
 */

var LS_ORDER = 'jdrs.desk.order';
var TINTS = {
	status:   '#46D8FF',
	network:  '#4FD1A5',
	services: '#A99BFF',
	system:   '#FFB84D',
	storage:  '#7FC8FF',
	security: '#FF8A8A',
	proxy:    '#46D8FF'
};

function make(cls, html) {
	var n = document.createElement('div');
	if (cls) n.className = cls;
	if (html != null) n.innerHTML = html;
	return n;
}

function iconSvg(name, tint) {
	var body = D.icons[name];
	if (!body) {
		/* 兜底：一个小方块，绝不空白 */
		body = '<rect x="5" y="5" width="14" height="14" rx="3"/>';
	}
	return '<svg viewBox="0 0 24 24" stroke="%s" stroke-width="2" stroke-linecap="round" '
		+ 'stroke-linejoin="round" fill="none">%s</svg>'.format(tint || '#ffffff', body);
}

function store(key, val) {
	try {
		if (val === undefined) {
			var v = localStorage.getItem(key);
			return v ? JSON.parse(v) : null;
		}
		localStorage.setItem(key, JSON.stringify(val));
	}
	catch (e) { /* 隐私模式下静默 */ }
	return null;
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
			/* 兜底：桌面渲染失败也不要把人锁在空白页 */
			var fb = make('jdrs-desk');
			fb.style.padding = '40px 24px';
			var msg = make('d-tip-open');
			msg.innerHTML = '<div style="font-size:15px;color:#dfe8f4">桌面加载失败</div>'
				+ '<div style="font-size:12px;color:#7d8ba1;margin:8px 0 16px">' + (e && e.message ? e.message : 'unknown') + '</div>'
				+ '<a style="color:#46d8ff;font-size:13px" href="' + L.url('admin', 'status/overview') + '">返回状态总览</a>';
			fb.appendChild(msg);
			return fb;
		}
	},

	build: function(tree) {
		var self = this;
		this.editing = false;
		this.page = 0;
		this.guard = 0;

		var items = this.collect(tree);
		var saved = store(LS_ORDER) || [];
		if (saved.length) {
			var pos = {};
			saved.forEach(function(k, i) { pos[k] = i; });
			items.sort(function(a, b) {
				var pa = (a.key in pos) ? pos[a.key] : 1e9;
				var pb = (b.key in pos) ? pos[b.key] : 1e9;
				return pa - pb;
			});
		}
		this.items = items;

		var root = make('jdrs-desk');

		/* ---- 顶部状态条 ---- */
		var bar = make('d-bar');
		var clock = make('d-clock', '--:--');
		var host = make('d-host', (document.title.split('|')[0] || '').trim());
		var allBtn = make('d-allbtn', '<span>全部</span>');
		bar.appendChild(make('d-spacer'));
		bar.appendChild(clock);
		bar.appendChild(host);
		bar.appendChild(make('d-spacer'));
		bar.appendChild(allBtn);

		/* ---- 页面区 ---- */
		var pages = make('d-pages');
		var sheet = make('d-sheet');
		sheet.appendChild(pages);
		var dots = make('d-dots');
		sheet.appendChild(dots);

		/* ---- 抽屉 ---- */
		var drawer = this.buildDrawer(items);
		var scrim = make('d-scrim');

		var dock = make('d-dock');
		var dockBtn = make('d-dockbtn', '<div class="d-handle"></div>');
		dock.appendChild(dockBtn);

		root.appendChild(bar);
		root.appendChild(sheet);
		root.appendChild(dock);
		root.appendChild(scrim);
		root.appendChild(drawer);

		this.root = root;
		this.pagesEl = pages;
		this.dotsEl = dots;

		this.renderPages();

		/* ---- 时钟 ---- */
		var tick = function() {
			var d = new Date();
			clock.textContent = '%02d:%02d'.format(d.getHours(), d.getMinutes());
		};
		tick();
		poll.add(function() { tick(); }, 20);

		/* ---- 交互 ---- */
		this.bindSwipe(sheet, root);
		this.bindEdit(root, pages);
		allBtn.addEventListener('click', function() { self.openDrawer(drawer, scrim); });
		dockBtn.addEventListener('click', function() { self.openDrawer(drawer, scrim); });
		scrim.addEventListener('click', function() { self.closeDrawer(drawer, scrim); });

		window.addEventListener('resize', function() { self.renderPages(); });

		return root;
	},

	/* 菜单树 → 桌面条目 */
	collect: function(tree) {
		var out = [];
		var secs = ui.menu.getChildren(tree);

		var pushItem = function(node, secName) {
			var path = (node.action && node.action.path) ? node.action.path : (secName + '/' + node.name);
			var key = 'admin/' + path;
			var ic = D.menu[key];
			if (!ic) {
				var secKey = 'admin/' + secName;
				ic = D.menu[secKey] || 'service';
			}
			out.push({
				key: key,
				title: _(node.title || node.name),
				icon: ic,
				group: D.groups[ic] || 'services',
				tint: TINTS[D.groups[ic]] || '#8FB4D8',
				url: L.url('admin', path)
			});
		};

		secs.forEach(function(sec) {
			var kids = ui.menu.getChildren(sec);
			if (!kids.length) {
				if (sec.action && (sec.action.type == 'view' || sec.action.type == 'template'))
					pushItem(sec, sec.name);
				return;
			}
			kids.forEach(function(k) { pushItem(k, sec.name); });
		});

		return out;
	},

	pageSize: function() {
		var w = window.innerWidth || 380;
		var h = (window.innerHeight || 700) - 150;
		var cols = w > 900 ? 6 : (w > 640 ? 5 : 4);
		var rows = Math.max(2, Math.floor(h / 92));
		return cols * rows;
	},

	renderPages: function() {
		var self = this;
		var per = this.pageSize();
		var total = Math.max(1, Math.ceil(this.items.length / per));
		if (this.page >= total) this.page = total - 1;

		var pages = this.pagesEl;
		pages.innerHTML = '';
		var track = make('d-track');
		pages.appendChild(track);

		for (var p = 0; p < total; p++) {
			var page = make('d-page');
			if (window.innerWidth > 640) page.style.gridTemplateColumns = 'repeat(' + (window.innerWidth > 900 ? 6 : 5) + ', 1fr)';
			this.items.slice(p * per, (p + 1) * per).forEach(function(it) {
				var tile = make('d-tile');
				tile.dataset.key = it.key;
				tile.dataset.url = it.url;
				tile.appendChild(make('d-ic', iconSvg(it.icon, it.tint)));
				tile.appendChild(make('d-tx', it.title));
				tile.addEventListener('click', function(ev) {
					if (self.editing) { ev.preventDefault(); ev.stopPropagation(); return; }
					if (Date.now() < self.guard) { ev.preventDefault(); return; }
					location.href = it.url;
				});
				page.appendChild(tile);
			});
			track.appendChild(page);
		}

		this.dotsEl.innerHTML = '';
		if (total > 1) {
			for (var i = 0; i < total; i++) {
				var dot = make('d-dot' + (i == this.page ? ' on' : ''));
				dot.dataset.i = i;
				dot.addEventListener('click', function(ev) {
					self.page = parseInt(ev.currentTarget.dataset.i, 10);
					self.slide();
				});
				this.dotsEl.appendChild(dot);
			}
		}

		this.slide();
	},

	slide: function() {
		var track = this.pagesEl.querySelector('.d-track');
		if (track) track.style.transform = 'translateX(-%d%%)'.format(this.page * 100);
		if (this.dotsEl) {
			Array.prototype.forEach.call(this.dotsEl.children, function(d, i) {
				d.className = 'd-dot' + (i == this.page ? ' on' : '');
			});
		}
	},

	/* 左右滑翻页；上滑开抽屉 */
	bindSwipe: function(sheet, root) {
		var self = this;
		var sx = 0, sy = 0, st = 0, dx = 0, dy = 0, active = false, moved = false;

		sheet.addEventListener('pointerdown', function(ev) {
			if (ev.target.closest('.d-dot')) return;
			active = true; moved = false;
			sx = ev.clientX; sy = ev.clientY; st = Date.now(); dx = 0; dy = 0;
		});

		sheet.addEventListener('pointermove', function(ev) {
			if (!active || self.editing) return;
			dx = ev.clientX - sx; dy = ev.clientY - sy;
			if (Math.abs(dx) > 8 || Math.abs(dy) > 8) moved = true;
		});

		sheet.addEventListener('pointerup', function(ev) {
			if (!active) return;
			active = false;
			var dt = Date.now() - st;
			if (self.editing) return;

			if (moved && dy < -70 && Math.abs(dy) > Math.abs(dx) * 1.4) {
				self.openDrawer(root.querySelector('.d-drawer'), root.querySelector('.d-scrim'));
				self.guard = Date.now() + 350;
				return;
			}

			if (moved && Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4 && dt < 900) {
				var total = self.pagesEl.querySelectorAll('.d-page').length;
				if (dx < 0 && self.page < total - 1) self.page++;
				if (dx > 0 && self.page > 0) self.page--;
				self.slide();
				self.guard = Date.now() + 350;
			}
		});

		sheet.addEventListener('pointercancel', function() { active = false; });
	},

	/* 长按进入编辑 + 拖动排序 */
	bindEdit: function(root, pages) {
		var self = this;
		var pressTimer = null, picked = null, startKey = null;

		var cleanup = function() {
			if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
			picked = null;
			pages.querySelectorAll('.d-tile.pick').forEach(function(t) { t.classList.remove('pick'); });
		};

		pages.addEventListener('pointerdown', function(ev) {
			var tile = ev.target.closest('.d-tile');
			if (!tile) return;

			if (!self.editing) {
				startKey = tile.dataset.key;
				pressTimer = setTimeout(function() {
					self.enterEdit(root);
					navigator.vibrate && navigator.vibrate(18);
					/* 长按后立刻把这块拎起来 */
					tile.classList.add('pick');
					picked = tile;
				}, 430);
			}
			else {
				picked = tile;
				tile.classList.add('pick');
			}
		});

		pages.addEventListener('pointermove', function(ev) {
			if (pressTimer && (Math.abs(ev.movementX) > 6 || Math.abs(ev.movementY) > 6)) {
				clearTimeout(pressTimer); pressTimer = null;
			}
			if (!picked) return;
			ev.preventDefault();
			var over = document.elementFromPoint(ev.clientX, ev.clientY);
			var tile = over && over.closest('.d-tile');
			pages.querySelectorAll('.d-tile.over').forEach(function(t) {
				if (t !== tile) t.classList.remove('over');
			});
			if (tile && tile !== picked) tile.classList.add('over');
		}, { passive: false });

		pages.addEventListener('pointerup', function(ev) {
			if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
			if (!picked) return;

			var over = document.elementFromPoint(ev.clientX, ev.clientY);
			var target = over && over.closest('.d-tile');
			if (target && target !== picked) self.swap(picked, target, root);

			cleanup();
			self.guard = Date.now() + 400;
		});

		/* 点空白退出编辑 */
		root.addEventListener('click', function(ev) {
			if (self.editing && !ev.target.closest('.d-tile') && !ev.target.closest('.d-allbtn')) {
				self.exitEdit(root);
			}
		});
	},

	enterEdit: function(root) {
		this.editing = true;
		root.classList.add('editing');
		if (!root.querySelector('.d-tip')) {
			var tip = make('d-tip', '拖动图标调整顺序 · 点空白完成');
			root.appendChild(tip);
		}
	},

	exitEdit: function(root) {
		this.editing = false;
		root.classList.remove('editing');
		var tip = root.querySelector('.d-tip');
		if (tip) tip.remove();
	},

	swap: function(a, b, root) {
		var ka = a.dataset.key, kb = b.dataset.key;
		var ia = -1, ib = -1;
		this.items.forEach(function(it, i) {
			if (it.key === ka) ia = i;
			if (it.key === kb) ib = i;
		});
		if (ia < 0 || ib < 0) return;

		var tmp = this.items[ia];
		this.items[ia] = this.items[ib];
		this.items[ib] = tmp;

		store(LS_ORDER, this.items.map(function(it) { return it.key; }));
		this.renderPages();

		var same = root.querySelector('.d-tile[data-key="%s"]'.format(kb));
		if (same) {
			same.classList.add('pick');
			setTimeout(function() { same.classList.remove('pick'); }, 180);
		}
		navigator.vibrate && navigator.vibrate(10);
	},

	/* 抽屉：全部菜单 + 搜索 */
	buildDrawer: function(items) {
		var drawer = make('d-drawer');
		var head = make('d-dhead');
		var title = make('d-dtitle', '全部应用');
		var close = make('d-dclose', '<span>完成</span>');
		var box = make('d-search');
		var input = document.createElement('input');
		input.type = 'search';
		input.placeholder = '搜索应用…';
		box.appendChild(input);

		var list = make('d-list');

		var paint = function(kw) {
			list.innerHTML = '';
			var q = (kw || '').trim().toLowerCase();
			var shown = 0;

			/* 按分组归类展示 */
			['status', 'network', 'services', 'system'].forEach(function(g) {
				var groupItems = items.filter(function(it) { return it.group === g; });
				if (q) groupItems = groupItems.filter(function(it) { return it.title.toLowerCase().indexOf(q) >= 0 || it.key.toLowerCase().indexOf(q) >= 0; });
				if (!groupItems.length) return;

				var gh = make('d-gtitle', ({status: '状态', network: '网络', services: '服务', system: '系统'})[g]);
				list.appendChild(gh);

				var wrap = make('d-gwrap');
				groupItems.forEach(function(it) {
					var row = make('d-row');
					var ric = make('d-ric'); ric.appendChild(make('x', iconSvg(it.icon, it.tint)).firstChild); row.appendChild(ric);
					row.appendChild(make('d-rtx', it.title));
					row.addEventListener('click', function() {
						location.href = it.url;
					});
					wrap.appendChild(row);
					shown++;
				});
				list.appendChild(wrap);
			});

			if (!shown) list.appendChild(make('d-empty', '没有匹配的应用'));
		};

		input.addEventListener('input', function() { paint(input.value); });
		close.addEventListener('click', function() {
			var scrim = drawer.parentNode.querySelector('.d-scrim');
			drawer.classList.remove('open');
			if (scrim) scrim.classList.remove('open');
		});

		head.appendChild(title);
		head.appendChild(close);
		drawer.appendChild(make('d-handle2'));
		drawer.appendChild(head);
		drawer.appendChild(box);
		drawer.appendChild(list);
		paint('');

		return drawer;
	},

	openDrawer: function(drawer, scrim) {
		if (this.editing) this.exitEdit(this.root);
		drawer.classList.add('open');
		scrim.classList.add('open');
		var input = drawer.querySelector('input');
		if (input) setTimeout(function() { input.focus(); }, 260);
	},

	closeDrawer: function(drawer, scrim) {
		drawer.classList.remove('open');
		scrim.classList.remove('open');
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
