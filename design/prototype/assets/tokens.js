/* 上岸罗盘 · R176 设计令牌（Tailwind CDN config）*/
tailwind.config = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50:'#eef6ff',100:'#d9ebff',200:'#bcdcff',300:'#8ec6ff',
          400:'#59a7ff',500:'#3385ff',600:'#1a66f5',700:'#1450e1',
          800:'#1742b6',900:'#193c8f',950:'#14265c',
        },
        surface: {
          page:'#f7f8fa', card:'#ffffff', raised:'#ffffff', sunken:'#f1f3f6',
          'page-d':'#0b0e14', 'card-d':'#121722', 'raised-d':'#1a2130', 'sunken-d':'#0e121b',
        },
        ink: {
          1:'#111827', 2:'#4b5563', 3:'#9ca3af',
          '1d':'#f3f4f6', '2d':'#9aa4b2', '3d':'#5b6472',
        },
        line: { DEFAULT:'#e5e7eb', d:'#232b3b' },
        // 语义色（板块/状态）
        tizhi:'#1a66f5',   // 体制内 · 蓝
        campus:'#0ea5a4',  // 校招 · 青
        bianzhi:'#8b5cf6', // 编制 · 紫
        danger:'#e11d48', warn:'#d97706', ok:'#059669',
      },
      fontSize: {
        // 字阶：12/13/14/16/18/22/28
        'xs2':['12px','16px'], 'xs1':['13px','18px'], 'body':['14px','22px'],
        'md1':['16px','24px'], 'lg1':['18px','26px'], 'xl1':['22px','30px'], 'xxl':['28px','36px'],
      },
      borderRadius: { 'sm2':'6px', 'md2':'10px', 'lg2':'14px', 'xl2':'20px' },
      boxShadow: {
        'card':'0 1px 2px rgba(16,24,40,.05)',
        'raised':'0 4px 16px -2px rgba(16,24,40,.10), 0 1px 3px rgba(16,24,40,.06)',
        'overlay':'0 24px 64px -12px rgba(16,24,40,.28)',
        'card-d':'0 1px 2px rgba(0,0,0,.4)',
      },
      spacing: { '4.5':'18px' },
    },
  },
}
