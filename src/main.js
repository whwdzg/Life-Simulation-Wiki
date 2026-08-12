import './style.css'

const imageBase = 'https://static.wikia.nocookie.net/lifesimulation/images'

const activities = {
  server: [
    ['S1', '3rd Life + Boogeyman规则', 'f/f2/%E6%9D%A5%E7%A6%8Flogo.png/revision/latest/scale-to-width-down/160?cb=20260331073451&path-prefix=zh', '第一季（3rd Life+Boogeyman规则）'],
    ['S1.5', 'Double Life规则', 'f/f6/S1.9%EF%BC%88Double_Life%E8%A7%84%E5%88%99%EF%BC%89LOGO.png/revision/latest/scale-to-width-down/160?cb=20260402174637&path-prefix=zh', '第二季（Double Life规则）'],
    ['S1.7', 'Simple Life规则', 'd/d7/Simple_life_LOGO.png/revision/latest/scale-to-width-down/160?cb=20260402065811&path-prefix=zh', '第三季（Simple Life规则）'],
    ['S1.9', 'Double Life规则', 'a/a4/%E6%9D%A5%E7%A6%8Fdl%E7%AC%AC%E4%BA%8C%E5%AD%A3logo.png/revision/latest/scale-to-width-down/160?cb=20260402174710&path-prefix=zh', 'S1.9（Double Life规则）'],
    ['S2', 'Limited Life规则', 'e/e3/Limited_life_logo.png/revision/latest/scale-to-width-down/160?cb=20260331075811&path-prefix=zh', 'S2 Limited Life'],
    ['S3', 'Secret Life规则', 'b/b0/Secret_life_logo.png/revision/latest/scale-to-width-down/160?cb=20260711162323&path-prefix=zh', 'S3 Secret Life'],
  ],
  practice: [
    ['Life练习服1.0', '加命游戏（来福Simulation S1）', '9/98/%E7%BB%83%E4%B9%A0%E6%9C%8D1.0-Logo.png/revision/latest/scale-to-width-down/160?cb=20260329055413&path-prefix=zh', 'Life练习服2.0'],
    ['Life练习服2.0', '', '5/56/%E7%BB%83%E4%B9%A0%E6%9C%8D2.0-Logo.png/revision/latest/scale-to-width-down/160?cb=20260329055705&path-prefix=zh', 'Life练习服'],
  ],
}

const members = [
  ['673_iii', '4/40/673_iii%E8%84%91%E8%A2%8B.png/revision/latest?cb=20251110044546&path-prefix=zh'], ['XTLY_0628', 'e/ec/XTLY_0628%E8%B0%A2%E7%A4%BC%E8%84%91%E8%A2%8B.png/revision/latest?cb=20251110050207&path-prefix=zh'], ['AnIII_TND', '4/45/AnIII_TND%E8%84%91%E8%A2%8B.png/revision/latest?cb=20260205134257&path-prefix=zh'], ['dKyzYos', '2/25/DKyzYos%E8%84%91%E8%A2%8B.png/revision/latest?cb=20251110050636&path-prefix=zh'], ['HanaAiko', '3/36/HanaAiko.png/revision/latest?cb=20251110050806&path-prefix=zh'], ['Hanth_79', '3/3f/Hanth_79%E8%84%91%E8%A2%8B.png/revision/latest?cb=20251110050850&path-prefix=zh'], ['HarrisNailo', 'd/de/HarrisNailo%E8%84%91%E8%A2%8B.png/revision/latest?cb=20251110051605&path-prefix=zh'], ['Kiss_qi', '4/4b/Kiss_qi%E8%84%91%E8%A2%8B.png/revision/latest?cb=20251110051734&path-prefix=zh'], ['LimitedShadow', '8/8c/LimitedShadow%E8%84%91%E8%A2%8B.png/revision/latest?cb=20251110051838&path-prefix=zh'], ['simicpig', 'f/ff/Simicpig%E8%84%91%E8%A2%8B.png/revision/latest?cb=20251110052056&path-prefix=zh'], ['timeDDD', 'a/af/TimeDDD%E8%84%91%E8%A2%8B.png/revision/latest?cb=20251110052606&path-prefix=zh'], ['DINENO', 'e/e0/DINENO%E8%84%91%E8%A2%8B.png/revision/latest?cb=20251110053413&path-prefix=zh'], ['Arc_y', '9/99/Arc_y%E8%84%91%E8%A2%8B.png/revision/latest?cb=20260205134312&path-prefix=zh'], ['mobai23', '6/64/Yional%E8%84%91%E8%A2%8B.png/revision/latest?cb=20260329154924&path-prefix=zh'], ['YunYuanlonely', '7/76/YunYuanlonely%E8%84%91%E8%A2%8B.png/revision/latest?cb=20260221153958&path-prefix=zh'], ['whwdzg', '0/02/Whwdzg%E8%84%91%E8%A2%8B.png/revision/latest?cb=20260607101359&path-prefix=zh'], ['Chassignite', '5/57/Chassignite%E8%84%91%E8%A2%8B.png/revision/latest?cb=20260608081838&path-prefix=zh'], ['NotShameToBeLast', '5/5d/NotShameToBeLast%E8%84%91%E8%A2%8B.png/revision/latest?cb=20260627134916&path-prefix=zh'], ['wymlovesmtlsaid', '1/1a/STEVE%E8%84%91%E8%A2%8B.png/revision/latest?cb=20260207145510&path-prefix=zh'], ['KaterYss9', '8/82/KaterYss9%E5%A4%B4%E5%83%8F.png/revision/latest?cb=20260620065007&path-prefix=zh'],
]

const participation = [
  ['673_iii', '1-6', '1-3', '1-3', '1-3', '1-6', ''], ['XTLY_0628', '1-6', '1-3', '', '', '', ''], ['AnIII_TND', '1-6', '1-3', '1-3', '1-2', '1-6', ''], ['dKyzYos', '1-6', '1-3', '', '1-3', '1-6', ''], ['HanaAiko', '5-6', '', '', '', '', ''], ['Hanth_79', '1-5', '1-3', '', '', '缺席5、6（替补）', ''], ['HarrisNailo', '1-3', '', '缺席2', '1-3', '', ''], ['Kiss_qi', '缺席3', '', '', '', '', ''], ['LimitedShadow', '1-4', '1', '1-3', '1-3', '1,3,5', ''], ['simicpig', '缺席2', '1-2', '1-2', '', '1-6', ''], ['timeDDD', '缺席3、4', '1-2', '1-3', '1-2', '仅参与1', ''], ['Arc_y', '', '1', '2-3', '', '', ''], ['mobai23', '', '', '缺席2', '1-2', '1-6', ''], ['YunYuanlonely', '', '', '2', '1-3', '缺席4', ''], ['NotShameToBeLast', '', '', '', '', '5-6', ''], ['KaterYss9', '', '', '', '', '5-6（替补）', ''], ['kokology710', '1-6', '1', '1-3', '1-2', '缺席3', ''], ['Forget_me_nots', '', '1-2', '', '', '', ''], ['DINENO', '', '1-3', '1-3', '1-3', '1-6', ''], ['PlumBlossomFall', '缺席1、4', '', '', '', '', ''], ['wymlovesmtlsaid', '', '', '', '', '', '1'],
]

const wikiLink = (label, page = label) => `<a href="#" class="wiki-link" data-page="${page}">${label}</a>`
const gallery = (items) => items.map(([title, subtitle, image, page]) => `<article class="activity-card"><a class="image-link wiki-link" href="#" data-page="${page}"><img src="${imageBase}/${image}" alt="${title}" loading="lazy"></a><h4>${wikiLink(title, page)}</h4>${subtitle ? `<p>${subtitle}</p>` : ''}</article>`).join('')
const memberGrid = members.map(([name, image]) => `<a href="#" class="member wiki-link" data-page="${name}"><img src="${imageBase}/${image}" alt="${name}" loading="lazy"><span>${name}</span></a>`).join('')
const rows = participation.map((row, index) => `<tr><td>${index + 1}</td><td>${wikiLink(row[0])}</td>${row.slice(1).map((value) => `<td class="${value ? '' : 'empty'}">${value}</td>`).join('')}</tr>`).join('')

document.querySelector('#app').innerHTML = `
  <header class="site-header"><a class="site-title" href="#top">来福Simulation Wiki</a><nav aria-label="主导航"><a href="#top" class="active">首页</a><a href="#activities">服务器活动</a><a href="#members">成员</a><a href="#participation">参与情况</a></nav><form class="search" role="search"><label class="sr-only" for="search-input">搜索 Wiki</label><input id="search-input" type="search" placeholder="搜索这个 Wiki"><button aria-label="搜索" type="submit">⌕</button></form></header>
  <main id="top" class="layout"><aside class="toc" aria-label="页面目录"><p>目录</p><a href="#about">什么是来福Simulation？</a><a href="#activities">服务器活动</a><a href="#members">参与成员</a><a href="#participation">成员参与情况</a><a href="#misc">杂</a></aside><article class="page-content">
    <section class="welcome" aria-labelledby="welcome-title"><img class="wordmark" src="${imageBase}/d/d6/%E6%9D%A5%E7%A6%8FSimulation%E4%B8%8A%E4%B8%8B%E8%A3%81%E5%89%AA%E7%89%88.png/revision/latest/scale-to-width-down/400?cb=20260208135049&path-prefix=zh" alt="来福Simulation"><h1 id="welcome-title">欢迎来到来福Simulation Wiki!</h1><p>这是一个<strong>非官方</strong>的维基，记录了关于 ${wikiLink('来福Simulation')} 的所有内容。<b>任何人都可以编辑！</b></p><small>已有 2,152 次编辑 · 63 篇文章 · 3 位活跃贡献者</small></section>
    <section id="about" class="section-block intro"><h2>什么是来福Simulation？</h2><p>${wikiLink('来福Simulation')} 是一个关于油管主Grian的 Life Series 粉丝向同人服务器，由练习服与活动服来福Simulation构成，服主：${wikiLink('673_iii')}。</p><p>招新视频发布于2025.08.02。</p></section>
    <section id="activities" class="section-block"><h2>服务器活动</h2><div class="tabs" role="tablist"><button class="tab active" type="button" role="tab" aria-selected="true" data-tab="server">来福Simulation</button><button class="tab" type="button" role="tab" aria-selected="false" data-tab="practice">练习服</button></div><div class="gallery" id="activity-gallery">${gallery(activities.server)}</div></section>
    <section id="members" class="section-block"><h2>参与成员</h2><div class="member-grid">${memberGrid}</div></section>
    <section id="participation" class="section-block"><h2>成员参与情况</h2><div class="table-scroll"><table class="participation-table"><thead><tr><th rowspan="2">序</th><th rowspan="2">账号名</th><th colspan="6">参与情况</th></tr><tr><th>第1季</th><th>第1.5季</th><th>第1.7季</th><th>第1.9季</th><th>第2季</th><th>第3季</th></tr></thead><tbody>${rows}</tbody></table></div></section>
    <section id="misc" class="section-block misc"><h2>杂</h2><p>${wikiLink('来福Simulation同人相关')}</p><p>${wikiLink('记·念')}</p></section></article>
    <aside class="quotes"><blockquote><p>什么？3rd life SMP招人了？？</p><cite>${wikiLink('673_iii')}, 2025.08.02</cite></blockquote><section><h2>名言墙</h2><p><b>${wikiLink('XTLY_0628')}</b>: “打不过可以大喊我们blue了。”</p><p class="attribution">—${wikiLink('来福Simulation')}<br><small>(add your own quote!)</small></p></section></aside></main>
  <dialog id="page-dialog"><button class="close-dialog" aria-label="关闭" type="button">×</button><p class="dialog-kicker">本地条目</p><h2 id="dialog-title"></h2><p>此迁移版本已保留首页中的站内链接入口。完整条目页面可按同一静态模板继续加入。</p></dialog><div id="toast" role="status" aria-live="polite"></div>`

const galleryElement = document.querySelector('#activity-gallery')
const dialog = document.querySelector('#page-dialog')
const toast = document.querySelector('#toast')

document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((item) => { const active = item === tab; item.classList.toggle('active', active); item.setAttribute('aria-selected', String(active)) })
  galleryElement.innerHTML = gallery(activities[tab.dataset.tab])
}))
document.addEventListener('click', (event) => { const link = event.target.closest('.wiki-link'); if (!link) return; event.preventDefault(); document.querySelector('#dialog-title').textContent = link.dataset.page || link.textContent; dialog.showModal() })
document.querySelector('.close-dialog').addEventListener('click', () => dialog.close())
document.querySelector('.search').addEventListener('submit', (event) => { event.preventDefault(); const query = document.querySelector('#search-input').value.trim().toLowerCase(); if (!query) return; const match = [...document.querySelectorAll('.wiki-link')].find((link) => link.textContent.toLowerCase().includes(query)); if (match) { match.scrollIntoView({ behavior: 'smooth', block: 'center' }); match.classList.add('search-hit'); setTimeout(() => match.classList.remove('search-hit'), 1600) } else { toast.textContent = `未在首页找到“${query}”`; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2200) } })