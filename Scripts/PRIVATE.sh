#!/bin/bash

# 1. 拉取 daede（含统一 LuCI 界面）以及 openclash（仅纯界面，不预装内核与规则）
UPDATE_PACKAGE "daede" "kenzok8/openwrt-daede" "main" "" "dae daed luci-app-daede"
UPDATE_PACKAGE "luci-app-openclash" "vernesong/OpenClash" "dev" "pkg"

# 2. 精简多余主题（只留 luci-theme-argon，亚瑟皮肤就是接在它上面）和未使用的大型插件源码
KEEP_THEME="${WRT_THEME:-argon}"
for t in vantage aurora fluent footstrap kucat shadcn; do
	[ "$t" = "$KEEP_THEME" ] && continue
	rm -rf "./package/luci-theme-$t"
done
rm -rf ./package/luci-app-aurora-config ./package/luci-app-kucat-config
rm -rf ./package/OpenWrt-momo ./package/OpenWrt-nikki
rm -rf ./package/luci-app-passwall ./package/luci-app-passwall2
rm -rf ./package/luci-app-qbittorrent ./package/luci-app-openlist2 ./package/luci-app-mosdns
rm -rf ./package/QModem ./package/luci-app-airpi3000m-fancontrol ./package/luci-app-chfs
rm -rf ./package/luci-app-fm350 ./package/luci-app-h5000m-netmode ./package/luci-app-mt5700
rm -rf ./package/luci-app-mt5700m ./package/luci-app-netmonitor ./package/luci-app-qmodem-generic

# 3. 首次开机无损追加初始化逻辑（保留仓库原有 rc.local 逻辑，等所有 uci-defaults 完成后执行一次）
rm -f ./files/etc/uci-defaults/zzz-custom-wifi
mkdir -p ./files/etc
touch ./files/etc/rc.local
sed -i '/^[[:space:]]*exit 0[[:space:]]*$/d' ./files/etc/rc.local

cat <<'EOF' >> ./files/etc/rc.local

if [ ! -f /etc/.sys_init_done ]; then
	(
		sleep 15

		# A. 固化双频无线参数（避开 router-tool 首次重置）
		[ -s /etc/config/wireless ] || wifi config
		for radio in radio0 radio1; do
			band=$(uci -q get wireless.${radio}.band)
			if [ "$band" = "5g" ]; then
				uci set wireless.${radio}.country='CN'
				uci set wireless.${radio}.channel='36'
				uci set wireless.${radio}.htmode='HE80'
				uci set wireless.${radio}.disabled='0'
			elif [ "$band" = "2g" ]; then
				uci set wireless.${radio}.country='CN'
				uci set wireless.${radio}.channel='1'
				uci set wireless.${radio}.htmode='HT20'
				uci set wireless.${radio}.disabled='0'
			fi
		done
		uci -q set wireless.default_radio0.disabled='0'
		uci -q set wireless.default_radio1.disabled='0'
		uci commit wireless
		wifi reload

		touch /etc/.sys_init_done
	) &
fi

exit 0
EOF
chmod +x ./files/etc/rc.local

# 4. 内核分区扩容至 12MB 及冗余冲突包清理（集中收口，防止同步上游覆盖 Handles.sh 后失效）
if [ -f "./target/linux/qualcommax/image/ipq60xx.mk" ]; then
	sed -i 's/KERNEL_SIZE := 6144k/KERNEL_SIZE := 12288k/g' "./target/linux/qualcommax/image/ipq60xx.mk"
fi
rm -rf ./package/viking/luci-app-homeproxy ./package/viking/sing-box
rm -rf ./package/viking/gecoosac
rm -rf ./package/viking/luci-app-wolultra ./package/viking/luci-app-upnp
rm -rf ./package/natmapt ./package/stuntman ./package/luci-app-natmapt
rm -rf ./feeds/packages/net/fullconenat-sonic ./feeds/luci/applications/luci-app-fullconenat-sonic
rm -rf ./feeds/luci/applications/luci-app-upnp ./feeds/packages/net/miniupnpd
rm -rf ./feeds/luci/applications/luci-app-samba4

# 5. 「服务」菜单顺序钉死：daede = 1，OpenClash = 2（hornk 已移除，不再参与排序）
set_menu_order() {
	local pkg="$1" value="$2" f
	for f in $(find ./package ./feeds -path "*/$pkg/*" -name "*.json" 2>/dev/null); do
		awk -v v="$value" '
			!done && /"order"[[:space:]]*:[[:space:]]*[0-9]+/ {
				sub(/"order"[[:space:]]*:[[:space:]]*[0-9]+/, "\"order\": " v); done=1
			}
			{ print }
		' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
	done
}
set_menu_order luci-app-daede 1
set_menu_order luci-app-openclash 2

# 5.5 iStore 应用商店（apk 原生：/etc/apk/arch 存在时 is-opkg 自动走 repo-apk）
rm -rf ./package/istore-src
if git clone --depth=1 --single-branch --branch main https://github.com/istoreos/istore.git ./package/istore-src 2>/dev/null; then
	for p in luci-app-store luci-lib-taskd luci-lib-xterm taskd; do
		if [ -d "./package/istore-src/luci/$p" ]; then
			rm -rf "./package/$p"
			cp -rf "./package/istore-src/luci/$p" ./package/
		fi
	done
	rm -rf ./package/istore-src
	echo "iStore: 已集成 luci-app-store"
else
	rm -rf ./package/istore-src
	echo "iStore: 仓库拉取失败，本次不集成应用商店"
fi

# 6. 移植亚瑟定制面板：包体 + Argon 皮肤 + 构建标记
if [ -d "$GITHUB_WORKSPACE/package/arthur" ]; then
	rm -rf ./package/arthur
	cp -rf "$GITHUB_WORKSPACE/package/arthur" ./package/
	if command -v python3 >/dev/null 2>&1; then
		BUILD_ID="${WRT_MARK:-local}-${WRT_DATE:-$(date +%y.%m.%d-%H.%M.%S)}"
		python3 "$GITHUB_WORKSPACE/Scripts/arthur-theme.py" "$PWD" "$GITHUB_WORKSPACE" "$BUILD_ID" \
			|| echo "arthur-theme: 注入失败，皮肤问题不阻塞编译"
	else
		echo "arthur-theme: 镜像里没有 python3，跳过皮肤注入"
	fi
else
	echo "arthur-theme: 仓库缺少 package/arthur，跳过"
fi
