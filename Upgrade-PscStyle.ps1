#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Position = 0)][string]$RootPath = ".",
    [switch]$NoBackup,
    [switch]$WhatIf,
    [string[]]$Files,
    [string[]]$Folders = @("topics", "question-papers")
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$NewCss = @'
:root{--primary:#4a148c;--primary-light:#6a1b9a;--secondary:#00695c;--accent:#b83b2c;--bg:#fff;--light-bg:#f3e5f5;--border:#e1bee7;--text:#14202b;--text-light:#4a5f72;--important-bg:#fff8e1;--important-border:#f9a825;--memory-bg:#e8f5e9;--memory-border:#43a047;--trap-bg:#fce4ec;--trap-border:#c62828;--correction-bg:#fff3e0;--correction-border:#ef6c00;--added-bg:#e3f2fd;--added-border:#1976d2;--revision-bg:#f3e5f5;--revision-border:#8e24aa;--table-head:#4a148c;--table-alt:#f3e5f5;--star:#f9a825}
[data-theme="dark"]{--bg:#1e1e2e;--light-bg:#11111b;--border:#313244;--text:#cdd6f4;--text-light:#a6adc8;--primary:#cba6f7;--primary-light:#b4befe;--important-bg:#2c2518;--important-border:#f9a825;--memory-bg:#192b22;--memory-border:#43a047;--trap-bg:#2d1920;--trap-border:#c62828;--correction-bg:#2c2018;--correction-border:#ef6c00;--added-bg:#182432;--added-border:#1976d2;--revision-bg:#22182b;--revision-border:#8e24aa;--table-head:#6a1b9a;--table-alt:#181825}
[data-theme="sepia"]{--bg:#fdf6e3;--light-bg:#eee8d5;--border:#d3cbb7;--text:#433422;--text-light:#65533c;--primary:#7b4b1e;--primary-light:#9c6b3a;--important-bg:#f7efd8;--memory-bg:#e9f0dd;--trap-bg:#f4e0e0;--correction-bg:#f8e8d4;--added-bg:#e0e8f0;--revision-bg:#ece0ee;--table-head:#7b4b1e;--table-alt:#f2ead4}
[data-theme="dark"] .question-item,[data-theme="dark"] .viz-box,[data-theme="dark"] .options .opt-btn{background:#181825;color:var(--text)}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Noto Sans Malayalam','Manjari','Rachana','Nirmala UI',Arial,sans-serif;font-size:16px;line-height:1.7;color:var(--text);background:var(--light-bg);padding:16px;transition:background .3s,color .3s}
.layout{display:grid;grid-template-columns:260px 1fr;gap:20px;max-width:1400px;margin:0 auto}
.toc{position:sticky;top:16px;height:calc(100vh - 32px);overflow-y:auto;background:var(--bg);border-radius:12px;box-shadow:0 2px 12px rgba(74,20,140,.1);padding:16px;align-self:start}
.toc-title{font-size:18px;font-weight:700;color:var(--primary);margin-bottom:12px;padding-bottom:8px;border-bottom:2px solid var(--border)}
.toc-controls{display:flex;gap:6px;margin-bottom:12px}
.toc-controls button{flex:1;padding:6px 8px;font-size:11px;font-family:inherit;background:var(--light-bg);color:var(--primary);border:1px solid var(--border);border-radius:6px;cursor:pointer;transition:.2s}
.toc-controls button:hover{background:var(--primary);color:#fff}
.toc-nav{list-style:none}.toc-nav li{margin-bottom:2px}
.toc-nav a{display:block;padding:6px 10px;font-size:13px;color:var(--text-light);text-decoration:none;border-radius:6px;border-left:3px solid transparent;transition:.2s}
.toc-nav a:hover{background:var(--light-bg);color:var(--primary)}
.toc-nav a.active{background:var(--light-bg);color:var(--primary);border-left-color:var(--primary);font-weight:600}
.progress-wrap{margin-top:12px;padding-top:10px;border-top:1px solid var(--border)}
.progress-label{font-size:12px;color:var(--text-light);margin-bottom:6px;display:flex;justify-content:space-between;font-weight:600}
.progress-track{width:100%;height:8px;background:var(--light-bg);border-radius:4px;overflow:hidden;border:1px solid var(--border)}
.progress-fill{height:100%;width:0%;background:linear-gradient(90deg,var(--primary),var(--secondary));transition:width .3s ease}
.main-container{background:var(--bg);border-radius:16px;box-shadow:0 4px 24px rgba(74,20,140,.12);padding:24px;min-width:0}
.chapter-header{background:linear-gradient(135deg,#4a148c 0%,#6a1b9a 100%);color:#fff;border-radius:12px;padding:24px;margin-bottom:24px}
.chapter-header .label{font-size:12px;text-transform:uppercase;letter-spacing:1.5px;opacity:.85;margin-bottom:8px}
.chapter-header h1{font-size:26px;line-height:1.4;margin-bottom:8px}
.chapter-header .subtitle{font-size:14px;opacity:.9;font-style:italic}
.utility-bar{display:flex;flex-wrap:wrap;gap:10px;justify-content:space-between;align-items:center;background:var(--light-bg);padding:10px 16px;border-radius:10px;margin-bottom:20px;border:1px solid var(--border)}
.search-input{flex:1;min-width:200px;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);font-family:inherit;font-size:14px}
.utility-btns{display:flex;gap:8px;flex-wrap:wrap}
.util-btn{padding:7px 12px;font-size:13px;font-family:inherit;font-weight:600;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--primary);cursor:pointer;transition:.2s}
.util-btn:hover{background:var(--light-bg)}.util-btn.active{background:var(--primary);color:var(--bg)}
body.recall-mode strong{filter:blur(5px);background:rgba(106,27,154,.15);border-radius:4px;padding:0 4px;cursor:pointer;transition:filter .2s ease;user-select:none}
body.recall-mode strong:hover,body.recall-mode strong.revealed{filter:blur(0)}
.section{margin-bottom:20px;border:1px solid var(--border);border-radius:10px;overflow:hidden}
.section h2{background:var(--light-bg);color:var(--primary);padding:14px 18px;font-size:19px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;user-select:none;transition:background .2s;border-radius:0;margin:0;gap:10px}
.section h2:hover{background:#ede7f6}[data-theme="dark"] .section h2:hover{background:#2a2a3c}
.section h2:focus{outline:2px solid var(--primary);outline-offset:-2px}
.section-title-text{flex:1}
.section-done-check{width:18px;height:18px;cursor:pointer;accent-color:var(--secondary);flex-shrink:0}
.toggle-icon{font-size:14px;transition:transform .3s;color:var(--primary)}
.section.collapsed .toggle-icon{transform:rotate(-90deg)}
.section.collapsed > *:not(h2){display:none}
.section-body{padding:16px 18px}
.important,.memory,.trap,.correction,.added-fact,.revision,.last-minute,.viz-box{padding:14px 16px;border-radius:8px;margin:12px 0;border-left:5px solid;box-shadow:0 1px 4px rgba(0,0,0,.06)}
.important{background:var(--important-bg);border-left-color:var(--important-border)}
.memory{background:var(--memory-bg);border-left-color:var(--memory-border)}
.trap{background:var(--trap-bg);border-left-color:var(--trap-border)}
.correction{background:var(--correction-bg);border-left-color:var(--correction-border)}
.added-fact{background:var(--added-bg);border-left-color:var(--added-border)}
.revision{background:var(--revision-bg);border-left-color:var(--revision-border)}
.last-minute{background:#4a148c;color:#fff;border-left-color:#7c43bd}.last-minute strong{color:#ffd54f}
.viz-box{background:var(--bg);border-left-color:var(--primary);text-align:center;border:1px solid var(--border)}
.viz-caption{font-size:13px;color:var(--text-light);margin-top:8px;font-style:italic}
.box-label{font-weight:700;font-size:15px;margin-bottom:6px;display:block}
.stars{color:var(--star);font-size:13px;letter-spacing:1px}
ul,ol{padding-left:22px;margin:8px 0}li{margin-bottom:6px}
table{width:100%;border-collapse:collapse;margin:12px 0;font-size:14px;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.06)}
thead th{background:var(--table-head);color:#fff;padding:10px 12px;text-align:left;font-weight:600}
tbody td{padding:8px 12px;border-bottom:1px solid var(--border)}
tbody tr:nth-child(even){background:var(--table-alt)}tbody tr:hover{background:var(--light-bg)}
.quiz-dashboard{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;background:var(--light-bg);padding:14px 18px;border-radius:10px;margin-bottom:16px;border:2px solid var(--primary);position:sticky;top:10px;z-index:50}
.score-stats{display:flex;gap:16px;font-weight:700;font-size:14px;flex-wrap:wrap}
.score-stats span{color:var(--text)}.sc-correct{color:var(--memory-border)}.sc-wrong{color:var(--trap-border)}.sc-total{color:var(--primary)}
.question-item{background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:16px;margin:14px 0}
.q-text{font-weight:600;font-size:15.5px;margin-bottom:10px;color:var(--primary)}
.options{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px}
.options .opt-btn{display:block;padding:8px 12px;background:var(--bg);color:var(--text);border:1.5px solid var(--border);border-radius:8px;cursor:pointer;transition:.2s;font-size:14px;font-family:inherit;text-align:left;width:100%}
.options .opt-btn:hover{border-color:var(--primary-light);background:var(--light-bg)}
.options .opt-btn.selected{border-color:var(--primary);background:var(--light-bg);font-weight:600}
.options .opt-btn.correct{border-color:var(--memory-border);background:#c8e6c9;color:#14202b}
.options .opt-btn.wrong{border-color:var(--trap-border);background:#ffcdd2;color:#14202b}
.options .opt-btn.locked{cursor:not-allowed;opacity:.8}
[data-theme="dark"] .options .opt-btn.correct{background:#1e4d2b;color:#cdd6f4}
[data-theme="dark"] .options .opt-btn.wrong{background:#4d1e22;color:#cdd6f4}
.q-controls{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:8px}
.q-controls button{padding:6px 12px;font-size:12px;font-family:inherit;border:1px solid var(--border);border-radius:6px;cursor:pointer;background:var(--bg);color:var(--text);transition:.2s}
.q-controls button:hover{background:var(--light-bg)}
.btn-save{background:var(--secondary)!important;color:#fff!important;border-color:var(--secondary)!important}
.btn-show{background:var(--primary)!important;color:#fff!important;border-color:var(--primary)!important}
.btn-mark.active{background:var(--star)!important;color:#14202b!important;border-color:var(--star)!important}
.btn-lock{background:var(--accent)!important;color:#fff!important;border-color:var(--accent)!important}
.q-status{font-size:12px;font-weight:600;margin-left:auto;color:var(--text-light)}
.answer-block{display:none;margin-top:10px;padding:10px 14px;background:var(--memory-bg);border-radius:8px;border-left:4px solid var(--memory-border)}
.answer-block.show{display:block}
.answer-label{font-weight:700;color:var(--secondary);margin-bottom:4px}
.explanation{font-size:13.5px;color:var(--text-light)}
h3{font-size:17px;color:var(--primary);margin:14px 0 8px}p{margin:8px 0}
strong{color:var(--primary)}.last-minute strong{color:#ffd54f}
.checklist{list-style:none;padding-left:0}.checklist li::before{content:"\2714 ";color:var(--secondary);font-weight:700}
@media(max-width:900px){.layout{grid-template-columns:1fr}.toc{position:sticky;top:0;height:auto;max-height:60px;overflow-x:auto;overflow-y:hidden;padding:8px 12px;border-radius:0 0 12px 12px;z-index:100}.toc-title,.toc-controls,.progress-wrap{display:none}.toc-nav{display:flex;gap:6px;white-space:nowrap;padding-bottom:4px}.toc-nav li{margin:0}.toc-nav a{padding:6px 12px;background:var(--light-bg);border-radius:20px;border-left:none;font-size:12px}.toc-nav a.active{background:var(--primary);color:#fff}.quiz-dashboard{position:static}}
@media(max-width:600px){body{font-size:15.2px}.chapter-header h1{font-size:21px}.section h2{font-size:17.5px}h3{font-size:16px}table{font-size:12px}thead th,tbody td{padding:6px 8px}.q-text{font-size:14.7px}.options{grid-template-columns:1fr}.options .opt-btn{font-size:13.5px}}
@media print{body{background:#fff;font-size:10.5pt;padding:0;color:#000}.layout{display:block}.toc,.utility-bar,.quiz-dashboard,.section-done-check{display:none}.main-container{box-shadow:none;border-radius:0;padding:0}.chapter-header{-webkit-print-color-adjust:exact;print-color-adjust:exact}.last-minute{-webkit-print-color-adjust:exact;print-color-adjust:exact;background:#4a148c!important;color:#fff!important}.section.collapsed > *:not(h2){display:block!important}.section{page-break-inside:avoid;border:1px solid #ccc}.section h2{cursor:default;background:#f3e5f5!important}.toggle-icon{display:none}.q-controls{display:none}.answer-block{display:block!important}}
.map-container{max-width:100%;overflow-x:auto}.map-container svg{max-width:100%;height:auto}
'@

$NewJs = @'
document.addEventListener('DOMContentLoaded',function(){
'use strict';
var SLUG='__SLUG__';var QUIZ_PREFIX='pscQuiz_'+SLUG+'_';var SEC_PREFIX='pscSec_'+SLUG+'_';var THEME_KEY='pscThemeGlobal';
var sections=Array.from(document.querySelectorAll('.section'));var tocLinks=Array.from(document.querySelectorAll('.toc-nav a'));
sections.forEach(function(sec){var h2=sec.querySelector('h2');if(h2&&!h2.querySelector('.toggle-icon')){var i=document.createElement('span');i.className='toggle-icon';i.textContent='\u25BE';h2.appendChild(i);}});
function toggleSection(sec){var c=sec.classList.toggle('collapsed');var h2=sec.querySelector('h2');if(h2)h2.setAttribute('aria-expanded',String(!c));}
function openOnly(sec){sec.classList.remove('collapsed');var h2=sec.querySelector('h2');if(h2)h2.setAttribute('aria-expanded','true');}
sections.forEach(function(sec){var h2=sec.querySelector('h2');if(!h2)return;h2.addEventListener('click',function(e){if(e.target.classList&&e.target.classList.contains('section-done-check'))return;toggleSection(sec);});h2.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){if(e.target.classList&&e.target.classList.contains('section-done-check'))return;e.preventDefault();toggleSection(sec);}});});
if(sections.length>0)openOnly(sections[0]);
var expandAllBtn=document.getElementById('expandAll');var collapseAllBtn=document.getElementById('collapseAll');
if(expandAllBtn)expandAllBtn.addEventListener('click',function(){sections.forEach(function(s){s.classList.remove('collapsed');var h2=s.querySelector('h2');if(h2)h2.setAttribute('aria-expanded','true');});});
if(collapseAllBtn)collapseAllBtn.addEventListener('click',function(){sections.forEach(function(s){s.classList.add('collapsed');var h2=s.querySelector('h2');if(h2)h2.setAttribute('aria-expanded','false');});});
var themeBtn=document.getElementById('toggleTheme');var themes=['light','dark','sepia'];var currentThemeIdx=0;
function themeLabel(t){return t==='dark'?'\uD83D\uDCDC Sepia':t==='sepia'?'\u2600\uFE0F Light':'\uD83C\uDF19 Dark';}
try{var savedTheme=localStorage.getItem(THEME_KEY);if(savedTheme&&themes.indexOf(savedTheme)!==-1){currentThemeIdx=themes.indexOf(savedTheme);document.documentElement.setAttribute('data-theme',savedTheme);if(themeBtn)themeBtn.textContent=themeLabel(savedTheme);}}catch(e){}
if(themeBtn)themeBtn.addEventListener('click',function(){currentThemeIdx=(currentThemeIdx+1)%themes.length;var n=themes[currentThemeIdx];document.documentElement.setAttribute('data-theme',n);themeBtn.textContent=themeLabel(n);try{localStorage.setItem(THEME_KEY,n);}catch(e){}});
var recallBtn=document.getElementById('toggleRecall');
if(recallBtn){recallBtn.addEventListener('click',function(){var a=document.body.classList.toggle('recall-mode');recallBtn.classList.toggle('active',a);document.querySelectorAll('strong.revealed').forEach(function(el){el.classList.remove('revealed');});});document.body.addEventListener('click',function(e){if(document.body.classList.contains('recall-mode')&&e.target.tagName==='STRONG')e.target.classList.toggle('revealed');});}
var searchInput=document.getElementById('noteSearch');
if(searchInput)searchInput.addEventListener('input',function(){var q=this.value.trim().toLowerCase();sections.forEach(function(sec){if(!q){sec.style.display='';return;}if(sec.textContent.toLowerCase().indexOf(q)!==-1){sec.classList.remove('collapsed');sec.style.display='';}else{sec.style.display='none';}});});
var doneChecks=Array.from(document.querySelectorAll('.section-done-check'));var progressFill=document.getElementById('progressFill');var progressPercent=document.getElementById('progressPercent');
function updateProgress(){var t=doneChecks.length;var c=doneChecks.filter(function(x){return x.checked;}).length;var p=t>0?Math.round((c/t)*100):0;if(progressFill)progressFill.style.width=p+'%';if(progressPercent)progressPercent.textContent=p+'%';}
doneChecks.forEach(function(chk){var secId=chk.getAttribute('data-sec');try{if(localStorage.getItem(SEC_PREFIX+secId)==='1')chk.checked=true;}catch(e){}chk.addEventListener('click',function(e){e.stopPropagation();});chk.addEventListener('change',function(){try{if(chk.checked)localStorage.setItem(SEC_PREFIX+secId,'1');else localStorage.removeItem(SEC_PREFIX+secId);}catch(e){}updateProgress();});});
updateProgress();
tocLinks.forEach(function(link){link.addEventListener('click',function(e){e.preventDefault();var tid=link.getAttribute('href');if(!tid)return;var t=document.querySelector(tid);if(!t)return;openOnly(t);tocLinks.forEach(function(l){l.classList.remove('active');});link.classList.add('active');var p=t.getBoundingClientRect().top+window.pageYOffset-20;window.scrollTo({top:p,behavior:'smooth'});});});
if('IntersectionObserver' in window){var observer=new IntersectionObserver(function(entries){entries.forEach(function(entry){if(entry.isIntersecting){var id=entry.target.getAttribute('id');if(!id)return;tocLinks.forEach(function(link){link.classList.remove('active');if(link.getAttribute('href')==='#'+id)link.classList.add('active');});}});},{rootMargin:'-15% 0px -75% 0px',threshold:0});sections.forEach(function(s){observer.observe(s);});}
var questionItems=Array.from(document.querySelectorAll('.question-item'));
function updateScoreboard(){var t=questionItems.length,c=0,w=0;questionItems.forEach(function(it){var q=it.getAttribute('data-qindex');if(q===null)return;try{var s=localStorage.getItem(QUIZ_PREFIX+q);if(s){var p=JSON.parse(s);if(p&&p.saved&&p.selected&&p.correctLetter){if(p.selected===p.correctLetter)c++;else w++;}}}catch(e){}});var tEl=document.getElementById('scTotal');var cEl=document.getElementById('scCorrect');var wEl=document.getElementById('scWrong');if(tEl)tEl.textContent=t;if(cEl)cEl.textContent=c;if(wEl)wEl.textContent=w;}
questionItems.forEach(function(item){var qIndex=item.getAttribute('data-qindex');if(qIndex===null)return;var storageKey=QUIZ_PREFIX+qIndex;var answerBlock=item.querySelector('.answer-block');var answerLabel=item.querySelector('.answer-block .answer-label')||item.querySelector('.answer-label');var optionsContainer=item.querySelector('.options');if(!optionsContainer)return;var optionSpans=Array.from(optionsContainer.querySelectorAll('button.opt-btn'));var correctLetter=null;if(answerLabel){var txt=answerLabel.textContent;['A','B','C','D'].forEach(function(L){if(!correctLetter&&txt.indexOf('('+L+')')!==-1)correctLetter=L;});}if(answerBlock)answerBlock.style.display='none';var state={selected:null,saved:false,marked:false,locked:false,correctLetter:correctLetter};try{var s=localStorage.getItem(storageKey);if(s){var p=JSON.parse(s);if(p){state.selected=p.selected||null;state.saved=!!p.saved;state.marked=!!p.marked;state.locked=!!p.locked;state.correctLetter=p.correctLetter||correctLetter;}}}catch(e){}
if(state.selected)optionSpans.forEach(function(sp){if(sp.getAttribute('data-opt')===state.selected)sp.classList.add('selected');});
if(state.saved&&state.selected&&correctLetter){optionSpans.forEach(function(sp){var o=sp.getAttribute('data-opt');if(o===correctLetter)sp.classList.add('correct');if(o===state.selected&&o!==correctLetter)sp.classList.add('wrong');});if(answerBlock)answerBlock.style.display='block';}
var controls=document.createElement('div');controls.className='q-controls';var saveBtn=document.createElement('button');saveBtn.type='button';saveBtn.className='btn-save';saveBtn.textContent='Save Answer';var showBtn=document.createElement('button');showBtn.type='button';showBtn.className='btn-show';showBtn.textContent='Show Answer';var markBtn=document.createElement('button');markBtn.type='button';markBtn.className='btn-mark';markBtn.textContent='Mark for Review';var lockBtn=document.createElement('button');lockBtn.type='button';lockBtn.className='btn-lock';lockBtn.textContent='\uD83D\uDD12 Lock';var statusSpan=document.createElement('span');statusSpan.className='q-status';controls.appendChild(saveBtn);controls.appendChild(showBtn);controls.appendChild(markBtn);controls.appendChild(lockBtn);controls.appendChild(statusSpan);optionsContainer.parentNode.insertBefore(controls,optionsContainer.nextSibling);if(state.marked)markBtn.classList.add('active');
function persist(){try{localStorage.setItem(storageKey,JSON.stringify(state));}catch(e){}}
function showResult(){if(!state.selected||!correctLetter)return;optionSpans.forEach(function(sp){sp.classList.remove('correct','wrong');var o=sp.getAttribute('data-opt');if(o===correctLetter)sp.classList.add('correct');if(o===state.selected&&o!==correctLetter)sp.classList.add('wrong');});statusSpan.textContent=(state.selected===correctLetter)?'\u2705 Correct':'\u274C Wrong';if(answerBlock)answerBlock.style.display='block';}
function applyLock(l){state.locked=l;optionSpans.forEach(function(sp){if(l)sp.classList.add('locked');else sp.classList.remove('locked');});if(l){lockBtn.textContent='\uD83D\uDD13 Unlock';statusSpan.textContent='Locked';if(state.selected)showResult();}else{lockBtn.textContent='\uD83D\uDD12 Lock';if(!state.saved)statusSpan.textContent='Unlocked';else showResult();}persist();}
if(state.locked)applyLock(true);
optionSpans.forEach(function(sp){sp.addEventListener('click',function(){if(state.locked)return;optionSpans.forEach(function(x){x.classList.remove('selected','correct','wrong');});sp.classList.add('selected');state.selected=sp.getAttribute('data-opt');state.saved=false;statusSpan.textContent='';if(answerBlock)answerBlock.style.display='none';persist();});});
saveBtn.addEventListener('click',function(){if(state.locked)return;if(!state.selected){statusSpan.textContent='Select an option';return;}state.saved=true;persist();showResult();statusSpan.textContent+=' \u2014 Saved';updateScoreboard();});
showBtn.addEventListener('click',function(){if(!answerBlock)return;if(answerBlock.style.display==='none'||answerBlock.style.display==='')answerBlock.style.display='block';else answerBlock.style.display='none';});
markBtn.addEventListener('click',function(){state.marked=!state.marked;markBtn.classList.toggle('active',state.marked);persist();});
lockBtn.addEventListener('click',function(){applyLock(!state.locked);});});
updateScoreboard();
function resetAllQuiz(){if(!confirm('\u0D0E\u0D32\u0D4D\u0D32\u0D3E \u0D09\u0D24\u0D4D\u0D24\u0D30\u0D19\u0D4D\u0D19\u0D33\u0D41\u0D02 \u0D31\u0D40\u0D38\u0D46\u0D31\u0D4D\u0D31\u0D4D \u0D1A\u0D46\u0D2F\u0D4D\u0D2F\u0D23\u0D4B?'))return;try{Object.keys(localStorage).forEach(function(k){if(k.indexOf(QUIZ_PREFIX)===0)localStorage.removeItem(k);});}catch(e){}location.reload();}
var rb=document.getElementById('resetQuiz');if(rb)rb.addEventListener('click',resetAllQuiz);
var rbb=document.getElementById('resetQuizBottom');if(rbb)rbb.addEventListener('click',resetAllQuiz);
});
'@

$UtilityBar = @'
    <!-- UTILITY BAR -->
    <div class="utility-bar">
      <input type="search" id="noteSearch" class="search-input" placeholder="&#x1F50D; &#x0D15;&#x0D41;&#x0D31;&#x0D3F;&#x0D2A;&#x0D4D;&#x0D2A;&#x0D41;&#x0D15;&#x0D33;&#x0D3F;&#x0D7D; &#x0D24;&#x0D3F;&#x0D30;&#x0D2F;&#x0D41;&#x0D15;...">
      <div class="utility-btns">
        <button type="button" class="util-btn" id="toggleRecall">&#x1F9E0; Flashcard Mode</button>
        <button type="button" class="util-btn" id="toggleTheme">&#x1F319; Dark Mode</button>
        <button type="button" class="util-btn" id="resetQuiz">&#x1F504; Reset Quiz</button>
      </div>
    </div>
'@
$TocControls = @'
    <div class="toc-controls">
      <button id="expandAll" type="button">&#x0D0E;&#x0D32;&#x0D4D;&#x0D32;&#x0D3E;&#x0D02; &#x0D24;&#x0D41;&#x0D31;&#x0D15;&#x0D4D;&#x0D15;&#x0D41;&#x0D15;</button>
      <button id="collapseAll" type="button">&#x0D0E;&#x0D32;&#x0D4D;&#x0D32;&#x0D3E;&#x0D02; &#x0D05;&#x0D1F;&#x0D2F;&#x0D4D;&#x0D15;&#x0D4D;&#x0D15;&#x0D41;&#x0D15;</button>
    </div>
'@
$ProgressBar = @'
    <div class="progress-wrap">
      <div class="progress-label"><span>&#x1F4CA; &#x0D2A;&#x0D20;&#x0D28; &#x0D2A;&#x0D41;&#x0D30;&#x0D4B;&#x0D17;&#x0D24;&#x0D3F;</span><span id="progressPercent">0%</span></div>
      <div class="progress-track"><div class="progress-fill" id="progressFill"></div></div>
    </div>
'@
$QuizDashboard = @'
        <div class="quiz-dashboard">
          <div class="score-stats">
            <span class="sc-total">&#x1F4DD; &#x0D06;&#x0D15;&#x0D46;: <span id="scTotal">0</span></span>
            <span class="sc-correct">&#x2705; &#x0D36;&#x0D30;&#x0D3F;: <span id="scCorrect">0</span></span>
            <span class="sc-wrong">&#x274C; &#x0D24;&#x0D46;&#x0D31;&#x0D4D;&#x0D31;&#x0D4D;: <span id="scWrong">0</span></span>
          </div>
          <button type="button" class="util-btn" id="resetQuizBottom">&#x1F504; Reset</button>
        </div>
'@
$SectionCheckTitle = "Mark as completed"

function Get-Slug { param([string]$P)
    $n=[System.IO.Path]::GetFileNameWithoutExtension($P)
    $s=[regex]::Replace($n,'[^a-zA-Z0-9]+','_').Trim('_').ToLower()
    if($s.Length -eq 0){$s='file'};if($s.Length -gt 40){$s=$s.Substring(0,40)};return $s
}
function Replace-LastScript { param([string]$Html,[string]$Body)
    $m=[regex]::Matches($Html,'(?s)<script(?:\s[^>]*)?>.*?</script>')
    if($m.Count -eq 0){return $Html}
    $last=$m[$m.Count-1]
    return $Html.Substring(0,$last.Index)+"<script>`r`n$Body`r`n</script>"+$Html.Substring($last.Index+$last.Length)
}
function Update-HtmlContent { param([string]$Html,[string]$Slug)
    if ($Html -match 'id="toggleRecall"') { return @{Status='Skip';Html=$Html;Reason='already new style'} }
    if (($Html -match 'assets/css/app\.css') -or ($Html -match 'assets/js/engine\.js') -or ($Html -match 'id="view-notes"')) {
        return @{Status='Stub';Html=$Html;Reason='generated stub'}
    }
    if (($Html -notmatch 'class="section"') -or ($Html -notmatch 'class="section-body"')) {
        return @{Status='Unknown';Html=$Html;Reason='not a recognised content file'}
    }
    $title='Kerala PSC Notes'
    if ($Html -match '(?s)<title[^>]*>(.*?)</title>') { $title=$Matches[1].Trim() }
    $lang='ml'
    if ($Html -match '<html\s+lang="([^"]+)"') { $lang=$Matches[1] }
    $newHead=@"
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>$title</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Manjari:wght@400;700&family=Noto+Sans+Malayalam:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
$NewCss
  </style>
</head>
"@
    $hm=[regex]::Match($Html,'(?s)<head>.*?</head>')
    if ($hm.Success) { $Html=$Html.Substring(0,$hm.Index)+$newHead+$Html.Substring($hm.Index+$hm.Length) }
    $Html = Replace-LastScript -Html $Html -Body ($NewJs.Replace('__SLUG__',$Slug))
    if ($Html -notmatch 'id="noteSearch"') {
        $m=[regex]::Match($Html,'</header>')
        if ($m.Success) { $Html=$Html.Insert($m.Index+$m.Length,"`r`n`r`n$UtilityBar") }
    }
    if ($Html -notmatch 'id="expandAll"') {
        $m=[regex]::Match($Html,'(?s)<div class="toc-title">.*?</div>')
        if ($m.Success) { $Html=$Html.Insert($m.Index+$m.Length,"`r`n$TocControls") }
    }
    if ($Html -notmatch 'id="progressFill"') {
        $m=[regex]::Match($Html,'(?s)</ul>\s*</nav>')
        if ($m.Success) {
            $idx=$Html.IndexOf('</nav>',$m.Index)
            if ($idx -ge 0) { $Html=$Html.Insert($idx,"`r`n$ProgressBar`r`n  ") }
        }
    }
    $Html=[regex]::Replace($Html,'(?s)<span\s+data-opt="([^"]+)"\s*>(.*?)</span>',{
        param($m);'<button type="button" class="opt-btn" data-opt="'+$m.Groups[1].Value+'">'+$m.Groups[2].Value+'</button>'
    })
    $secRx=[regex]'(?s)<section[^>]*\sid="([^"]+)"[^>]*>\s*<h2([^>]*)>(.*?)</h2>'
    $sms=$secRx.Matches($Html)
    for ($i=$sms.Count-1; $i -ge 0; $i--) {
        $m=$sms[$i]; $secId=$m.Groups[1].Value; $attrs=$m.Groups[2].Value; $inner=$m.Groups[3].Value
        if ($inner -match 'section-title-text') { continue }
        $inner=[regex]::Replace($inner,'[\u25BE\u25B8]','').Trim()
        $h2Pos=$m.Value.IndexOf('<h2'); if ($h2Pos -lt 0) { continue }
        $prefix=$m.Value.Substring(0,$h2Pos)
        $newH2='<h2'+$attrs+'><input type="checkbox" class="section-done-check" data-sec="'+$secId+'" title="'+$SectionCheckTitle+'"><span class="section-title-text">'+$inner+'</span></h2>'
        $Html=$Html.Substring(0,$m.Index)+$prefix+$newH2+$Html.Substring($m.Index+$m.Length)
    }
    if ($Html -notmatch 'class="quiz-dashboard"') {
        $m=[regex]::Match($Html,'<div\s+class="question-item"')
        if ($m.Success) { $Html=$Html.Insert($m.Index,"$QuizDashboard`r`n`r`n        ") }
    }
    return @{Status='OK';Html=$Html;Reason=''}
}
function Process-File { param([string]$Path,[bool]$DryRun)
    $r=[ordered]@{Path=$Path;Name=[System.IO.Path]::GetFileName($Path);Status='';Reason=''}
    try {
        if (-not (Test-Path -LiteralPath $Path)) { $r.Status='Missing'; return $r }
        $original=[System.IO.File]::ReadAllText($Path,[System.Text.Encoding]::UTF8)
        $upd=Update-HtmlContent -Html $original -Slug (Get-Slug $Path)
        $r.Status=$upd.Status; $r.Reason=$upd.Reason
        if ($upd.Status -ne 'OK') { return $r }
        if ($DryRun) { $r.Status='WhatIf'; return $r }
        if (-not $NoBackup) {
            $bak="$Path.bak"
            if (-not (Test-Path -LiteralPath $bak)) { Copy-Item -LiteralPath $Path -Destination $bak -Force }
        }
        [System.IO.File]::WriteAllText($Path,$upd.Html,(New-Object System.Text.UTF8Encoding $false))
    }
    catch { $r.Status='Fail'; $r.Reason=$_.Exception.Message }
    return $r
}
Write-Host ""
Write-Host "===============================================================" -ForegroundColor Magenta
Write-Host "  Kerala PSC Style Upgrader (topics + question-papers)" -ForegroundColor Magenta
Write-Host "===============================================================" -ForegroundColor Magenta
Write-Host ""
if (-not (Test-Path -LiteralPath $RootPath)) { Write-Host "Root path not found: $RootPath" -ForegroundColor Red; exit 1 }
$resolvedRoot=(Resolve-Path -LiteralPath $RootPath).Path
Write-Host "Root : $resolvedRoot" -ForegroundColor Cyan
if ($WhatIf)   { Write-Host "Mode : WHATIF (no writes)" -ForegroundColor Yellow }
if ($NoBackup) { Write-Host "Mode : NO BACKUPS" -ForegroundColor Yellow }
Write-Host ""
$targetFiles=@()
if ($Files -and $Files.Count -gt 0) {
    foreach ($f in $Files) {
        $full = if ([System.IO.Path]::IsPathRooted($f)) { $f } else { Join-Path $resolvedRoot $f }
        if (Test-Path -LiteralPath $full) { $targetFiles += (Get-Item -LiteralPath $full) }
        else { Write-Host "Not found: $f" -ForegroundColor Yellow }
    }
} else {
    foreach ($folder in $Folders) {
        $fp=Join-Path $resolvedRoot $folder
        if (-not (Test-Path -LiteralPath $fp)) { Write-Host "Folder not found: $fp" -ForegroundColor Yellow; continue }
        Write-Host "Scanning: $folder" -ForegroundColor Cyan
        $targetFiles += Get-ChildItem -LiteralPath $fp -Recurse -File -Filter "*.html" -ErrorAction SilentlyContinue
    }
}
$targetFiles = $targetFiles | Sort-Object FullName -Unique
if ($targetFiles.Count -eq 0) { Write-Host "No HTML files found." -ForegroundColor Yellow; exit 0 }
Write-Host ""
Write-Host "Found $($targetFiles.Count) HTML file(s)." -ForegroundColor Cyan
Write-Host ""
$stats=@{OK=0;Skip=0;Stub=0;Unknown=0;Fail=0;Missing=0;WhatIf=0}
$failures=@(); $i=0
foreach ($f in $targetFiles) {
    $i++
    Write-Progress -Activity "Upgrading" -Status "$i / $($targetFiles.Count)" -PercentComplete ([int](($i/$targetFiles.Count)*100)) -CurrentOperation $f.Name
    $res = Process-File -Path $f.FullName -DryRun:$WhatIf
    $stats[$res.Status] = $stats[$res.Status] + 1
    switch ($res.Status) {
        'OK'      { Write-Host "  [OK]      $($res.Name)" -ForegroundColor Green }
        'Skip'    { Write-Host "  [SKIP]    $($res.Name)  ($($res.Reason))" -ForegroundColor DarkGray }
        'WhatIf'  { Write-Host "  [WHATIF]  $($res.Name)" -ForegroundColor Yellow }
        'Stub'    { Write-Host "  [STUB]    $($res.Name)  (no content yet)" -ForegroundColor DarkCyan }
        'Unknown' { Write-Host "  [UNKNOWN] $($res.Name)  ($($res.Reason))" -ForegroundColor DarkYellow }
        'Fail'    { Write-Host "  [FAIL]    $($res.Name)  $($res.Reason)" -ForegroundColor Red; $failures += $res }
        'Missing' { Write-Host "  [MISS]    $($res.Name)" -ForegroundColor DarkYellow }
    }
}
Write-Progress -Activity "Upgrading" -Completed
Write-Host ""
Write-Host "===============================================================" -ForegroundColor Magenta
Write-Host "  Summary" -ForegroundColor Magenta
Write-Host "===============================================================" -ForegroundColor Magenta
Write-Host ("  Total found     : {0}" -f $targetFiles.Count)
Write-Host ("  Upgraded        : {0}" -f $stats.OK)      -ForegroundColor Green
Write-Host ("  Already new     : {0}" -f $stats.Skip)    -ForegroundColor DarkGray
Write-Host ("  Stub (skipped)  : {0}" -f $stats.Stub)    -ForegroundColor DarkCyan
Write-Host ("  Unknown format  : {0}" -f $stats.Unknown) -ForegroundColor DarkYellow
if ($stats.WhatIf -gt 0) { Write-Host ("  WhatIf          : {0}" -f $stats.WhatIf) -ForegroundColor Yellow }
if ($stats.Fail -gt 0)   { Write-Host ("  Failed          : {0}" -f $stats.Fail)   -ForegroundColor Red }
if ($failures.Count -gt 0) {
    Write-Host ""; Write-Host "Failures:" -ForegroundColor Red
    foreach ($f in $failures) { Write-Host ("  - {0}: {1}" -f $f.Path,$f.Reason) -ForegroundColor Red }
}
Write-Host ""
if ($stats.OK -gt 0) { Write-Host "Done." -ForegroundColor Green }
elseif ($stats.WhatIf -gt 0) { Write-Host "Dry run complete." -ForegroundColor Cyan }
else { Write-Host "Nothing to do." -ForegroundColor Cyan }