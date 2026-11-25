# JDCloud-RS

京东云亚瑟 AX1800 Pro（`qualcommax/ipq60xx` → `jdcloud_re-ss-01`）自用精简固件。

- 底座：`immortalwrt/immortalwrt` master（6.18 内核，**不含 NSS**，为 eBPF 让路）
- 内核槽：6144k → **12288k**（硬改双槽 uboot）
- 内核能力：只注入 eBPF/BTF 十个符号，不做全量
- 界面：原生 LuCI，不换主题
- 默认：`192.168.1.1` / WiFi `✈` / `12345678`

`Actions → Build JDCloud-RS → Run workflow` 即可出固件。
