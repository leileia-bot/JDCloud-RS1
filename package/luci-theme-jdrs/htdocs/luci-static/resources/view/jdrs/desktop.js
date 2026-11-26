'use strict';
'require view';
'require ui';
'require poll';
'require view.jdrs.data as D';
'require fs';

/*
 * JDRS 手机桌面 v1.7
 *   状态条：时间 / 温度 / 在线设备
 *   待机主页：大时钟 + 日期 + 天气·运行时长小组件 + 内存条 + 底部四个常用图标（dock）
 *   下拉 → 控制中心：快捷入口 + 温度/内存/在线/运行时长
 *   上滑 → 磨砂抽屉：应用图标网格（4 列）+ 搜索
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

function wideLayout() {
	return window.innerWidth >= 855;
}

function ty(p) {
	return wideLayout() ? 'translate(-50%, ' + p + ')' : 'translateY(' + p + ')';
}

function fmtUptime(sec) {
	var d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
	if (d > 0) return d + ' 天 ' + h + ' 小时';
	if (h > 0) return h + ' 小时 ' + m + ' 分';
	return m + ' 分钟';
}

function pct(used, total) {
	if (!total) return 0;
	return Math.min(100, Math.round(used / total * 100));
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

		/* ---- 状态条（时间 · 温度 · 在线） ---- */
		var top = make('d-sb');
		var sbTime = make('sb-time', '--:--');
		var sbTemp = make('sb-chip', '温度 --');
		var sbOn = make('sb-chip', '在线 0');
		top.appendChild(sbTime);
		top.appendChild(make('d-flex'));
		top.appendChild(sbTemp);
		top.appendChild(sbOn);

		/* ---- 大时钟 ---- */
		var clock = make('d-clock');
		clock.innerHTML = '<span class="h">--</span><span class="m">--</span><span class="s">00</span>';

		var dateRow = make('d-date', '--/--');

		/* ---- 小组件：天气 / 运行时长 ---- */
		var wxRow = make('d-wx');
		var wxChip = make('d-wxchip', '<b>--</b><i>天气加载中</i>');
		var upChip = make('d-wxchip', '<b>--</b><i>运行时长</i>');
		wxRow.appendChild(wxChip);
		wxRow.appendChild(upChip);

		/* ---- 内存条 ---- */
		var meters = make('d-meters');
		var memBar = make('d-meter', '<div class="mh"><span class="ml">内存</span><span class="mv">--</span></div>'
			+ '<div class="mt"><s></s></div>');
		var loadBar = make('d-meter', '<div class="mh"><span class="ml">负载</span><span class="mv">--</span></div>'
			+ '<div class="mt"><s></s></div>');
		meters.appendChild(memBar);
		meters.appendChild(loadBar);

		var dock = make('d-dockwrap');
		var dockGrid = make('d-dockgrid');
		dock.appendChild(dockGrid);
		dock.appendChild(make('d-hint', '<span class="arw">︿</span>上滑打开应用 · 下拉打开控制中心 · 长按整理'));

		home.appendChild(top);
		home.appendChild(make('d-flex'));
		home.appendChild(clock);
		home.appendChild(dateRow);
		home.appendChild(wxRow);
		home.appendChild(meters);
		home.appendChild(make('d-flex'));
		home.appendChild(dock);
		home.appendChild(make('d-homebar'));
		root.appendChild(home);

		/* ---- 控制中心 ---- */
		var cc = make('d-cc');
		cc.appendChild(make('d-cchandle'));

		var ccHead = make('d-cchead');
		var ccTitle = make('d-cctitle', '控制中心');
		var ccHost = make('d-cchost', (document.title.split('|')[0] || '').trim());
		ccHead.appendChild(ccTitle);
		ccHead.appendChild(make('d-flex'));
		ccHead.appendChild(ccHost);
		cc.appendChild(ccHead);

		var ccQuick = make('d-ccquick');
		var quicks = [
			{ ic: 'network', tx: '网络', g: 'network', path: 'network/network' },
			{ ic: 'wireless', tx: '无线', g: 'network', path: 'network/wireless' },
			{ ic: 'firewall', tx: '防火墙', g: 'network', path: 'network/firewall' },
			{ ic: 'reboot', tx: '重启', g: 'system', path: 'system/reboot' }
		];
		quicks.forEach(function(q) {
			/* 没装的插件就不出现在控制中心：桌面只长固件里真有的东西 */
			if (!self.byKey['admin/' + q.path])
				return;
			var ic = make('d-ccic', iconSvg(q.ic));
			ic.setAttribute('style', tintStyle(q.g));
			var t = make('d-ccq');
			t.appendChild(ic);
			t.appendChild(make('d-cctx', q.tx));
			t.addEventListener('click', function() {
				if (q.ic == 'reboot' && !confirm('重启路由器？')) return;
				location.href = L.url('admin', q.path);
			});
			ccQuick.appendChild(t);
		});
		cc.appendChild(ccQuick);

		var ccStats = make('d-ccstats');
		var ccTemp = make('d-ccs', '<i>温度</i><b>--</b>');
		var ccMem = make('d-ccs', '<i>内存</i><b>--</b>');
		var ccLoad = make('d-ccs', '<i>负载</i><b>--</b>');
		var ccUp = make('d-ccs', '<i>运行</i><b>--</b>');
		[ccTemp, ccMem, ccLoad, ccUp].forEach(function(n) { ccStats.appendChild(n); });
		cc.appendChild(ccStats);
		cc.appendChild(make('d-cchint', '上滑收起'));

		root.appendChild(cc);

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
		this.cc = cc;
		this.homeBar = root.querySelector('.d-homebar');

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
			sbTime.textContent = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
			dateRow.textContent = '%s/%s  %s'.format(pad2(d.getMonth() + 1), pad2(d.getDate()), WEEK[d.getDay()]);
		};
		tick();
		poll.add(tick, 20);

		/* ---- 状态采集：温度 / 内存 / 负载 / 运行时长 / 在线 ---- */
		this.refs = {
			sbTemp: sbTemp, sbOn: sbOn, upChip: upChip,
			memBar: memBar, loadBar: loadBar,
			ccTemp: ccTemp, ccMem: ccMem, ccLoad: ccLoad, ccUp: ccUp
		};

		var setBar = function(node, p, text) {
			node.querySelector('.mv').textContent = text;
			node.querySelector('s').style.width = (p || 0) + '%';
		};

		var readTemp = function() {
			var zones = ['/sys/class/thermal/thermal_zone0/temp',
				'/sys/class/thermal/thermal_zone1/temp',
				'/sys/class/thermal/thermal_zone2/temp'];
			for (var i = 0; i < zones.length; i++) {
				try {
					var v = parseInt(fs.read(zones[i]).trim(), 10);
					if (v > 0) return Math.round(v > 1000 ? v / 1000 : v);
				}
				catch (e) {}
			}
			return null;
		};

		this.refreshStats = function() {
			var st = self.refs;

			fs.read('/proc/meminfo').then(function(raw) {
				var mt = 0, ma = 0;
				(raw || '').split('\n').forEach(function(l) {
					var m = l.match(/^MemTotal:\s*(\d+)/); if (m) mt = +m[1];
					m = l.match(/^MemAvailable:\s*(\d+)/); if (m) ma = +m[1];
				});
				if (mt) {
					var used = mt - ma;
					var txt = (used / 1024).toFixed(0) + ' / ' + (mt / 1024 / 1024).toFixed(2) + ' G';
					setBar(st.memBar, pct(used, mt), (used / 1024).toFixed(0) + 'M / ' + (mt / 1024 / 1024).toFixed(2) + 'G');
					st.ccMem.lastChild.textContent = Math.round(used / mt * 100) + '%';
				}
			}).catch(function() {});

			fs.read('/proc/loadavg').then(function(raw) {
				var p = (raw || '').trim().split(' ').slice(0, 3);
				if (p.length) {
					var v = parseFloat(p[0]);
					setBar(st.loadBar, Math.min(100, v / 4 * 100), p.join(' · '));
					st.ccLoad.lastChild.textContent = p[0];
				}
			}).catch(function() {});

			fs.read('/proc/uptime').then(function(raw) {
				var sec = parseFloat((raw || '0').split(' ')[0]);
				if (sec > 0) {
					st.upChip.innerHTML = '<b>' + fmtUptime(sec) + '</b><i>运行时长</i>';
					st.ccUp.lastChild.textContent = fmtUptime(sec);
				}
			}).catch(function() {});

			var t = readTemp();
			if (t != null) {
				st.sbTemp.textContent = t + '°';
				st.ccTemp.lastChild.textContent = t + ' °C';
			}

			L.rpc.declare({ object: 'luci', method: 'getOnlineUsers' })().then(function(r) {
				var n = (r && typeof r.onlineusers == 'number') ? r.onlineusers : null;
				if (n != null) {
					st.sbOn.textContent = '在线 ' + n;
					self.online = n;
				}
			}).catch(function() {});

			L.rpc.declare({ object: 'luci-rpc', method: 'getWirelessClients' })().then(function(hosts) {
				if (hosts && typeof hosts == 'object' && Object.keys(hosts).length) {
					var n = Object.keys(hosts).length;
					if (n > (self.online || 0)) {
						st.sbOn.textContent = '在线 ' + n;
						self.online = n;
					}
				}
			}).catch(function() {});
		};

		this.refreshStats();
		poll.add(function() { self.refreshStats(); }, 20);

		/* ---- 天气（客户端直连，失败静默隐藏） ---- */
		wxChip.style.display = 'none';
		this.loadWeather = function() {
			try {
				var c = JSON.parse(localStorage.getItem('jdrs.wx.v2') || 'null');
				if (c && Date.now() - c.t < 1800000) {
					wxChip.innerHTML = c.h;
					wxChip.style.display = '';
					return;
				}
			}
			catch (e) {}

			Promise.all([
				fetch('https://ipapi.co/json/').then(function(r) { return r.json(); }).catch(function() { return null; }),
				Promise.resolve(null)
			]).then(function(res) {
				var g = res[0] || {};
				var lat = g.latitude, lon = g.longitude;
				if (!lat && !lon) throw new Error('no geo');
				var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon
					+ '&current=temperature_2m,weather_code&timezone=auto';
				return fetch(url).then(function(r) { return r.json(); }).then(function(w) {
					var cur = (w && w.current) || {};
					var t = Math.round(cur.temperature_2m);
					var code = cur.weather_code;
					var emo = code == 0 ? '☀️' : (code <= 3 ? '⛅' : (code <= 48 ? '🌫' : (code <= 67 ? '🌧' : (code <= 77 ? '❄️' : (code <= 82 ? '🌦' : '⛈')))));
					var city = (g.city || g.region || '').replace(/ (City|Province|Municipality)$/, '');
					var h = '<b>' + t + '° ' + emo + '</b><i>' + (city || '当地天气') + '</i>';
					wxChip.innerHTML = h;
					wxChip.style.display = '';
					try { localStorage.setItem('jdrs.wx.v2', JSON.stringify({ t: Date.now(), h: h })); } catch (e) {}
				});
			}).catch(function() { wxChip.style.display = 'none'; });
		};
		this.loadWeather();

		/* ---- 交互 ---- */
		this.bindSwipe(home, drawer);
		this.bindCC(cc);
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
		scrim.addEventListener('click', function() { self.closeCC(); self.close(); });

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
			var t = self.tile(it, false);
			t.style.animationDelay = (shown * 12) + 'ms';
			t.classList.add('in');
			self.grid.appendChild(t);
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

	openCC: function() {
		if (this.ccOpen) return;
		this.ccOpen = true;
		this.cc.classList.add('open');
		this.scrim.classList.add('open');
		this.home.classList.add('dim');
		if (navigator.vibrate) navigator.vibrate(6);
	},

	closeCC: function() {
		if (!this.ccOpen) return;
		this.ccOpen = false;
		this.cc.classList.remove('open');
		this.cc.style.transform = '';
		if (!this.drawer.classList.contains('open'))
			this.scrim.classList.remove('open');
		this.home.classList.remove('dim');
		this.guard = Date.now() + 220;
	},

	/* 主屏从顶部下拉 → 控制中心；控制中心上滑 → 收起 */
	bindCC: function(cc) {
		var self = this, start = 0, dragging = false;

		cc.addEventListener('pointerdown', function(ev) {
			if (ev.target.closest('.d-ccq')) return;
			start = ev.clientY;
			dragging = true;
		});
		cc.addEventListener('pointermove', function(ev) {
			if (!dragging) return;
			var d = ev.clientY - start;
			if (d < 0) {
				cc.classList.add('drag');
				cc.style.transform = ty(Math.max(-100, d / 3.5) + '%');
			}
		});
		cc.addEventListener('pointerup', function(ev) {
			if (!dragging) return;
			dragging = false;
			var d = ev.clientY - start;
			cc.classList.remove('drag');
			cc.style.transform = '';
			if (d < -60) self.closeCC();
		});
	},

	open: function() {
		this.closeCC();
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
		var active = false, moved = false, y0 = 0, dy = 0, t0 = 0, fromTop = false;

		home.addEventListener('pointerdown', function(ev) {
			if (ev.target.closest('.d-tile')) return;
			active = true; moved = false; y0 = ev.clientY; dy = 0; t0 = Date.now();
			fromTop = y0 < window.innerHeight * 0.32;
		});

		home.addEventListener('pointermove', function(ev) {
			if (!active) return;
			dy = ev.clientY - y0;
			if (Math.abs(dy) > 8) moved = true;
			if (dy < 0) {
				var shift = Math.min(1, -dy / 170);
				drawer.classList.add('drag');
				drawer.style.transform = ty((100 - shift * 100) + '%');
			}
			else if (dy > 0 && fromTop && !self.ccOpen) {
				self.cc.classList.add('drag');
				self.cc.style.transform = ty(Math.max(-100, -100 + Math.min(1, dy / 150) * 100) + '%');
			}
		});

		home.addEventListener('pointerup', function() {
			if (!active) return;
			active = false;
			drawer.classList.remove('drag');
			drawer.style.transform = '';
			if (!moved) return;
			self.cc.classList.remove('drag');
			self.cc.style.transform = '';
			var v = dy / Math.max(1, Date.now() - t0);
			if (dy < -55 || (v < -0.35 && dy < -18)) self.open();
			else if (dy > 60 && fromTop && !self.ccOpen) self.openCC();
			else if (dy > 60) self.close();
		});

		home.addEventListener('pointercancel', function() {
			active = false;
			drawer.classList.remove('drag');
			drawer.style.transform = '';
			self.cc.classList.remove('drag');
			self.cc.style.transform = '';
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
				drawer.style.transform = ty(Math.min(100, d / 3.5) + '%');
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
