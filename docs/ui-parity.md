# UI Parity Checklist

Target: reproduce the original 王阳 first screen as closely as possible with clean-room implementation.

## First Screen

- [x] 23 px dark title bar with centered title.
- [x] Left project pane: 51 px rail + 282 px project tree when the group shortcut rail is closed.
- [x] Left project pane can open the original-style 60 px project group shortcut rail, leaving the file tree at roughly 222 px.
- [x] Center canvas and right agent pane separated by 1 px borders.
- [x] Right agent pane fixed around 399 px.
- [x] Left rail labels: 文件 / 搜索 / 技能 / 智能 / 快照 / 知识 / 百宝箱.
- [x] Project tree sections: 规划 / 大纲 / 章节 / 角色 / 设定 / 记录 / 灵感 / 资产 / 技能 / 其他.
- [x] Project group shortcut rail maps to the original file groups: rules, outline, chapters, roles, objects, records, inspirations, assets, skills, and others.
- [x] Center welcome title and three action cards.
- [x] Right agent welcome, quick prompts, model row, composer actions.
- [x] Basic click interactions for first-screen buttons.
- [x] Application window icon resource is stored in the rebuild project and wired into the BrowserWindow.
- [x] Dark thin scrollbar styling is applied globally, with WebKit scrollbar support.
- [x] Global hover/focus/disabled states cover buttons, inputs, selects, textareas, and Ant Design controls.
- [x] Follow-up editor screen supports source, preview, dual, diff, CSV, shortcuts, line numbers, find/replace, save, and dirty-file confirmations.
- [x] Follow-up settings screens support user status, model config, prompt/context config, MCP/tools, editor, backup, and system settings.
- [x] Follow-up model config screen shows provider/model resolution, scenario mapping, text provider formats, and image scenario readiness.
- [x] Follow-up dialogs cover project settings, export, import, asset preview, image generation/edit, stats, dirty-file switching, and help.
- [x] Clean-room original-style icon set beyond the application icon is applied to the app shell, left rail, project tree, shortcut rail, and first-screen project actions.
- [x] Pixel-locked scrollbar geometry is applied globally, including fixed WebKit size, hidden scrollbar buttons, thumb minimum size, track edge, and hover/active thumb states.
- [x] Nested hover/focus/disabled states are covered for native controls, Ant Design controls, project-tree buttons, shortcut rails, editor surfaces, and agent/settings scrollable panels.
