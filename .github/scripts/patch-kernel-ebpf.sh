#!/bin/bash
# 只注入 eBPF/BTF 相关内核符号（不是全量），落进 target 的内核配置文件
# 原因：CONFIG_KERNEL_* 写进 .config 会被 make defconfig 丢掉，buildroot 只认 target 内核配置
set -e

KCONF=target/linux/qualcommax/config-6.18
[ -f "$KCONF" ] || { echo "ERROR: $KCONF not found"; exit 1; }

SYMS="
CONFIG_BPF_SYSCALL
CONFIG_BPF_JIT
CONFIG_BPF_JIT_ALWAYS_ON
CONFIG_BPF_UNPRIV_DEFAULT_OFF
CONFIG_BPF_EVENTS
CONFIG_BPF_STREAM_PARSER
CONFIG_CGROUP_BPF
CONFIG_NET_CLS_BPF
CONFIG_NET_ACT_BPF
CONFIG_XDP_SOCKETS
CONFIG_KPROBES
CONFIG_KPROBE_EVENTS
CONFIG_UPROBES
CONFIG_UPROBE_EVENTS
CONFIG_FTRACE
CONFIG_DEBUG_INFO
CONFIG_DEBUG_INFO_BTF
CONFIG_DEBUG_INFO_REDUCED
"

cp "$KCONF" "$KCONF.bak"
for s in $SYMS; do
	# 先删掉同名旧行（=y / =m / is not set），再追加 =y
	sed -i "/^${s}=/d; /^# ${s} is not set/d" "$KCONF"
	echo "${s}=y" >> "$KCONF"
done

echo "--- patched $KCONF ($(wc -l < "$KCONF") lines) ---"
grep -E '^CONFIG_(BPF_SYSCALL|BPF_EVENTS|DEBUG_INFO_BTF|KPROBES|FTRACE)=y' "$KCONF"
