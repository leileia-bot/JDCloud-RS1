#!/usr/bin/env python3
"""把亚瑟皮肤接进 Argon 主题模板（在 ./wrt 里运行）。

Argon 模板结构会随上游变动（3.1.4 起把 head.ut 并进 header.ut），所以每个锚点都是
可选的：找不到只打印 theme warning，构建继续。外观问题不该让整个构建失败。

用法: python3 Scripts/arthur-theme.py <wrt目录> <仓库根目录> <构建ID>
"""
import base64
import pathlib
import re
import sys

HEAD_TEMPLATES = ('head.ut', 'header.ut', 'header_login.ut')
LINK_MARKER = '/luci-static/arthur/theme.css'
MODE_ANCHORS = (
    ("mode = cfg.get_first('argon', 'global', 'mode');", "mode = 'light';"),
    ("let mode = 'normal';", "mode = 'light';"),
    ("mode = 'normal';", "mode = 'light';"),
)
FOOTER_TEMPLATES = ('footer.ut', 'page_scripts.ut')
WARNINGS = []


def warn(message):
    WARNINGS.append(message)
    print('theme warning: ' + message)


def inject_head(templates, block):
    patched = []
    head_found = False
    for name in HEAD_TEMPLATES:
        path = templates / name
        if not path.exists():
            continue
        text = path.read_text(encoding='utf-8')
        changed = False
        if '</head>' in text:
            head_found = True
        if '</head>' in text and LINK_MARKER not in text:
            text = text.replace('</head>', block + '</head>', 1)
            changed = True
        for pattern, replacement in MODE_ANCHORS:
            text, hits = re.subn(pattern, replacement, text, flags=re.M)
            if hits:
                changed = True
                break
        if changed:
            path.write_text(text, encoding='utf-8')
            patched.append(name)
    if not head_found:
        warn('Argon 模板里没有可注入的 </head>，亚瑟皮肤未生效')
    return patched


def inject_shell(templates, build_id):
    for name in FOOTER_TEMPLATES:
        path = templates / name
        if not path.exists():
            continue
        text = path.read_text(encoding='utf-8')
        anchor = "L.require('menu-argon')"
        if text.count(anchor) == 1:
            text = text.replace(anchor, anchor + f"; L.require('arthur-shell-{build_id}')")
            path.write_text(text, encoding='utf-8')
            return name
    warn('没找到 Argon 菜单模块锚点，亚瑟外壳脚本未加载')
    return None


def version_of(project):
    makefile = (project / 'package/arthur/Makefile').read_text(encoding='utf-8')
    match = re.search(r'PKG_VERSION:=([^\s]+)', makefile)
    return match.group(1) if match else '0.0.0'


def main(source, project, build_id):
    # 构建号直接写进 URL 与 JS 模块名，先把日期里的点号和非法字符换成连字符
    build_id = re.sub(r'[^a-zA-Z0-9_-]', '-', build_id.strip())[:64] or 'local'
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', build_id):
        raise SystemExit('invalid build id: ' + build_id)

    templates = source / 'package/luci-theme-argon/luci-theme-argon/ucode/template/themes/argon'
    if not templates.is_dir():
        warn('Argon 模板目录不存在，跳过皮肤注入')
        return 0

    version = version_of(project)
    assets = source / 'package/arthur/files/www/luci-static/arthur'
    resources = source / 'package/arthur/files/www/luci-static/resources'

    # 1. 主题样式：补齐构建号，避免浏览器缓存旧皮肤
    style = assets / 'theme.css'
    if style.exists():
        text = style.read_text(encoding='utf-8').replace('@ARTHUR_BUILD@', build_id)
        style.write_text(text, encoding='utf-8')
    else:
        warn('theme.css 缺失，皮肤背景不会加载')

    # 2. 头像包成内联 SVG，避免额外图片请求
    avatar = assets / 'avatar.jpg'
    if avatar.exists():
        encoded = base64.b64encode(avatar.read_bytes()).decode('ascii')
        icon = ('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">'
                '<image width="64" height="64" preserveAspectRatio="xMidYMid meet" '
                'href="data:image/jpeg;base64,' + encoded + '"/></svg>\n')
        (assets / 'favicon.svg').write_text(icon, encoding='utf-8')

    # 3. 注入 head：样式、浅色基线、图标与身份脚本
    # 状态概览：LuCI 把折叠状态存在 localStorage（值 'hide'），被记为隐藏的区块
    # 连内容都不渲染，CSS 压不开。进页面时先清掉这些 'hide' 键，再交给 CSS 强制展开。
    block = (
        '<script>try{if(location.pathname.indexOf("/admin/status")>=0){'
        'Object.keys(localStorage).forEach(function(k){'
        'if(localStorage.getItem(k)==="hide")localStorage.removeItem(k)})}}catch(e){}</script>\n'
        '<script>try{document.documentElement.dataset.arthurTheme='
        'localStorage.getItem("arthur-theme") === "dark" ? "dark" : "light"}catch(e){}</script>\n'
        f'<link rel="stylesheet" href="/luci-static/arthur/theme.css?v={build_id}">\n'
        f'<link rel="icon" type="image/jpeg" href="/luci-static/arthur/avatar.jpg?v={build_id}">\n'
        f'<link rel="icon" type="image/svg+xml" sizes="any" href="/luci-static/arthur/favicon.svg?v={build_id}">\n'
        f'<link rel="apple-touch-icon" href="/luci-static/arthur/avatar.jpg?v={build_id}">\n'
        f'<script defer src="/luci-static/arthur/apply-identity.js?v={build_id}"></script>\n'
    )
    inject_head(templates, block)

    # 4. 外壳脚本带构建号，菜单与顶栏注入靠它
    source_shell = resources / 'arthur-shell.js'
    if source_shell.exists():
        shell = source_shell.read_text(encoding='utf-8').replace('@ARTHUR_VERSION@', version)
        (resources / f'arthur-shell-{build_id}.js').write_text(shell, encoding='utf-8')
        inject_shell(templates, build_id)
    else:
        warn('arthur-shell.js 缺失，侧栏与搜索不会加载')

    # 5. 登录页换成亚瑟版，版本号写进页脚
    login = project / 'package/arthur/theme/sysauth.ut'
    target = templates / 'sysauth.ut'
    if login.exists() and target.exists():
        target.write_text(login.read_text(encoding='utf-8').replace('@ARTHUR_VERSION@', version), encoding='utf-8')
    else:
        warn('sysauth.ut 未替换，登录页保持 Argon 原样')

    # 6. 首页"构建版本"读取用的标记文件
    marker = source / 'package/arthur/files/etc/arthur-build'
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text(build_id + '\n', encoding='utf-8')

    print(f'arthur-theme: 皮肤注入完成（{build_id}，版本 {version}）')
    if WARNINGS:
        print(f'arthur-theme: {len(WARNINGS)} 项跳过，构建继续')
    return 0


if __name__ == '__main__':
    if len(sys.argv) != 4:
        raise SystemExit('usage: arthur-theme.py <wrt-dir> <project-dir> <build-id>')
    sys.exit(main(pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), sys.argv[3]))
