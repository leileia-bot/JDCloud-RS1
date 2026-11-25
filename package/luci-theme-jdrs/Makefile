#
# LuCI JDRS Aero Theme
#
# 纯 CSS/资源层主题：不改 LuCI 模板结构，可单独升级
#

include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI JDRS Aero Theme
LUCI_DEPENDS:=+luci-base
LUCI_PKGARCH:=all

PKG_PROVIDES:=luci-theme-jdrs
PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=JDCloud-RS

define Package/luci-theme-jdrs/postrm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	uci -q delete luci.themes.JDRS
	uci commit luci
}
endef

include ../../luci.mk
