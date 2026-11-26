#!/bin/sh
# 把 eMMC 设备定义与 DTS 段并入 immortalwrt 源码树
# 来源：VIKINGYFY/immortalwrt@owrt (target/linux/qualcommax)
set -e

ROOT="${1:-.}"
MK="$ROOT/target/linux/qualcommax/image/ipq60xx.mk"
DTS="$ROOT/target/linux/qualcommax/dts/ipq6000-re-ss-01.dts"
SNIP="$(dirname "$0")/../../dts/ipq6000-re-ss-01-emmc.dtsi"

# 1) eMMC 段并入板级 DTS（只插一次）
if ! grep -q 'JDRS-EMMC-SECTION' "$DTS"; then
	{
		echo ''
		echo '/* JDRS-EMMC-SECTION */'
		cat "$SNIP"
	} >> "$DTS"
fi

# 2) 设备定义：FitImage + EmmImage，12M 内核槽，产出 factory.bin
python3 - "$MK" <<'PY'
import re, sys
p = sys.argv[1]
s = open(p).read()

new = '''define Device/jdcloud_re-ss-01
\t$(call Device/FitImage)
\t$(call Device/EmmcImage)
\tDEVICE_VENDOR := JDCloud
\tDEVICE_MODEL := RE-SS-01
\tSOC := ipq6000
\tBLOCKSIZE := 64k
\tKERNEL_SIZE := 12288k
\tDEVICE_DTS_CONFIG := config@cp03-c2
\tDEVICE_PACKAGES := ipq-wifi-jdcloud_re-ss-01
\tIMAGE/factory.bin := append-kernel | pad-to $$(KERNEL_SIZE) | append-rootfs | append-metadata
endef
'''

pat = re.compile(r'define Device/jdcloud_re-ss-01\n.*?\nendef\n', re.S)
if 'Device/EmmcImage' not in s or 'KERNEL_SIZE := 12288k' not in pat.search(s).group(0):
    s = pat.sub(new, s, count=1)
    open(p, 'w').write(s)
    print('  ipq60xx.mk: device block replaced')
else:
    print('  ipq60xx.mk: already patched')
PY

# 3) EmmImage 定义存在性检查（immortalwrt master 已有）
if ! grep -q 'define Device/EmmcImage' "$ROOT/target/linux/qualcommax/image/Makefile"; then
	echo 'ERROR: image/Makefile 没有 Device/EmmcImage' >&2
	exit 1
fi

echo '--- jdcloud_re-ss-01 设备定义 ---'
sed -n '/define Device\/jdcloud_re-ss-01/,/TARGET_DEVICES += jdcloud_re-ss-01/p' "$MK"
echo '--- dts 尾部 ---'
tail -8 "$DTS"
