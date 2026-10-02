$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
if (-not $root) { $root = (Get-Location).Path }
$utf8 = New-Object System.Text.UTF8Encoding $false

Write-Host ''
Write-Host 'Kerala PSC - Topic Stub Generator' -ForegroundColor Cyan
Write-Host '=================================' -ForegroundColor Cyan
Write-Host ''

$topicData = @'
history|1.1.1|europeans-in-kerala|Europeans Arrival in Kerala
history|1.1.2|travancore-history|Travancore History
history|1.1.3|social-reform-movements|Social Reform Movements
history|1.1.4|religious-renaissance|Religious Renaissance Movements
history|1.1.5|national-movement|National Movement in Kerala
history|1.1.6|literary-sources|Literary Sources of Kerala History
history|1.1.7|aikya-kerala|Aikya Kerala Movement
history|1.1.8|kerala-after-1956|Kerala After 1956
history|1.2.1|british-rule|British Rule
history|1.2.2|first-war-independence|First War of Independence
history|1.2.3|formation-of-inc|Formation of INC
history|1.2.4|swadeshi-movement|Swadeshi Movement
history|1.2.5|social-reform-india|Social Reform Movements
history|1.2.6|journalism|Journalism
history|1.2.7|literature-art|Literature and Art
history|1.2.8|gandhi-freedom-struggle|Gandhi and Freedom Struggle
history|1.2.9|post-independence-india|Post-Independence India
history|1.2.10|states-reorganisation|States Reorganisation
history|1.2.11|science-education-tech|Science Education Technology
history|1.2.12|foreign-policy|Indias Foreign Policy
history|1.3.1|glorious-revolution|Glorious Revolution
history|1.3.2|american-war-independence|American War of Independence
history|1.3.3|french-revolution|French Revolution
history|1.3.4|russian-revolution|Russian Revolution
history|1.3.5|chinese-revolution|Chinese Revolution
history|1.3.6|post-wwii|Post-WWII Political History
history|1.3.7|united-nations|United Nations
history|1.3.8|international-organisations|International Organisations
geography|2.1.1|basic-principles|Basic Principles of Geography
geography|2.1.2|structure-of-earth|Structure of the Earth
geography|2.1.3|atmosphere|Atmosphere
geography|2.1.4|rocks|Rocks
geography|2.1.5|landforms|Landforms
geography|2.1.6|pressure-belt|Pressure Belt
geography|2.1.7|wind|Wind
geography|2.1.8|temperature|Temperature
geography|2.1.9|seasons|Seasons
geography|2.1.10|global-issues|Global Issues
geography|2.1.11|global-warming|Global Warming
geography|2.1.12|pollution|Pollution
geography|2.1.13|maps|Maps
geography|2.1.14|topographic-maps|Topographic Maps
geography|2.1.15|map-symbols|Map Symbols
geography|2.1.16|remote-sensing|Remote Sensing
geography|2.1.17|gis|GIS
geography|2.1.18|oceans|Oceans
geography|2.1.19|ocean-movements|Ocean Movements
geography|2.1.20|continents|Continents
geography|2.1.21|world-countries|World Countries and Features
geography|2.2.1|india-physiography|India Physiography
geography|2.2.2|states-features|States and Features
geography|2.2.3|northern-mountains|Northern Mountains
geography|2.2.4|india-rivers|India Rivers
geography|2.2.5|northern-plains|Northern Plains
geography|2.2.6|peninsular-plateau|Peninsular Plateau
geography|2.2.7|coastal-regions|Coastal Regions
geography|2.2.8|india-climate|India Climate
geography|2.2.9|natural-vegetation|Natural Vegetation
geography|2.2.10|india-agriculture|India Agriculture
geography|2.2.11|india-minerals|India Minerals
geography|2.2.12|india-industries|India Industries
geography|2.2.13|energy-resources|Energy Resources
geography|2.2.14|india-road|Road Transport
geography|2.2.15|india-water|Water Transport
geography|2.2.16|india-railway|Railway
geography|2.2.17|india-air|Air Transport
geography|2.3.3|kerala-rivers|Kerala Rivers
geography|2.3.5|kerala-natural-vegetation|Natural Vegetation
geography|2.3.6|kerala-wildlife|Wildlife
geography|2.3.7|kerala-agriculture|Kerala Agriculture
geography|2.3.8|research-institutions|Research Institutions
geography|2.3.9|kerala-minerals|Kerala Minerals
geography|2.3.10|kerala-industries|Kerala Industries
geography|2.3.11|kerala-energy|Kerala Energy
geography|2.3.12|kerala-road|Kerala Road Transport
geography|2.3.13|kerala-water-transport|Kerala Water Transport
geography|2.3.14|kerala-railway|Kerala Railway
geography|2.3.15|kerala-air-transport|Kerala Air Transport
economics|3.1|economic-system|Indian Economic System
economics|3.2|five-year-plans|Five-Year Plans
economics|3.3|planning-commission|Planning Commission
economics|3.4|niti-aayog|NITI Aayog
economics|3.5|new-economic-reforms|New Economic Reforms
economics|3.6|financial-institutions|Financial Institutions
economics|3.7|agricultural-crops|Agricultural Crops
economics|3.8|economics-minerals|Minerals
economics|3.9|green-revolution|Green Revolution
economics|3.10|direct-taxes|Direct Taxes
economics|3.11|indirect-taxes|Indirect Taxes
economics|3.12|gst-in-india|GST in India
constitution|4.1|constituent-assembly|Constituent Assembly
constitution|4.2|preamble|Preamble
constitution|4.3|citizenship|Citizenship
constitution|4.4|fundamental-rights|Fundamental Rights
constitution|4.5|directive-principles|Directive Principles
constitution|4.6|fundamental-duties|Fundamental Duties
constitution|4.7|central-government|Central Government
constitution|4.8|state-government|State Government
constitution|4.9|constitutional-institutions|Constitutional Institutions
constitution|4.10|functions-constitutional-institutions|Functions of Constitutional Institutions
constitution|4.11|panchayati-raj|Panchayati Raj
constitution|4.12|union-list|Union List
constitution|4.13|state-list|State List
constitution|4.14|concurrent-list|Concurrent List
constitution|4.15|special-priority-formats|Special-Priority Formats
constitution|4.16|amendments|Amendments
constitution|4.17|institution-article-function|Institution Article Function
constitution|4.18|cag|Comptroller and Auditor General
constitution|4.19|attorney-general|Attorney General
constitution|4.20|advocate-general|Advocate General
constitution|4.21|election-commission|Election Commission of India
constitution|4.22|state-election-commission|State Election Commission
constitution|4.23|upsc|UPSC
constitution|4.24|state-psc|State PSC
constitution|4.25|finance-commission|Finance Commission
constitution|4.26|state-finance-commission|State Finance Commission
constitution|4.27|gst-council|GST Council
constitution|4.28|distribution-legislative-powers|Distribution of Legislative Powers
constitution|4.29|services-union-states|Services Under Union and States
constitution|4.30|constitution-tribunals|Tribunals
constitution|4.31|ncsc|National Commission for Scheduled Castes
constitution|4.32|ncst|National Commission for Scheduled Tribes
constitution|4.33|ncbc|National Commission for Backward Classes
constitution|4.34|official-language|Official Language
constitution|4.35|regional-languages|Regional Languages
constitution|4.36|sc-hc-language|Language of Supreme Court and High Courts
constitution|4.37|special-directives-languages|Special Directives Relating to Languages
kerala-administration|5.1|kerala-civil-service|Kerala State Civil Service
kerala-administration|5.2|constitutional-institutions-kerala|Constitutional Institutions
kerala-administration|5.3|various-commissions|Various Commissions
kerala-administration|5.4|social-planning|Social Planning
kerala-administration|5.5|economic-planning|Economic Planning
kerala-administration|5.6|commercial-planning|Commercial Planning
kerala-administration|5.7|basic-information|Basic Information and Socio-Economic Development
kerala-administration|5.8|disaster-management-authority|Disaster Management Authority
kerala-administration|5.9|watershed-management|Watershed Management
kerala-administration|5.10|labour-employment|Labour and Employment
kerala-administration|5.11|nrega|National Rural Employment Programmes
kerala-administration|5.12|land-reforms|Land Reforms
kerala-administration|5.13|protection-women|Protection of Women
kerala-administration|5.14|protection-children|Protection of Children
kerala-administration|5.15|protection-senior-citizens|Protection of Senior Citizens
kerala-administration|5.16|social-welfare|Social Welfare
kerala-administration|5.17|social-security|Social Security
kerala-administration|5.18|quasi-judicial-bodies|Quasi-Judicial Bodies
kerala-administration|5.19|planning-board|Planning Board
kerala-administration|5.20|population|Population
kerala-administration|5.21|literacy|Literacy
kerala-administration|5.22|e-governance|E-Governance
kerala-administration|5.23|delegated-legislation|Delegated Legislation and Controls
kerala-administration|5.24|legislative-controls|Legislative Controls
kerala-administration|5.25|judicial-controls|Judicial Controls
kerala-administration|5.26|constitutional-remedies|Constitutional Remedies
kerala-administration|5.27|administrative-discretion|Administrative Discretion
kerala-administration|5.28|administrative-adjudication|Administrative Adjudication
kerala-administration|5.29|natural-justice|Principles of Natural Justice
biology|6.1|human-body|Human Body
biology|6.2|vitamins-minerals|Vitamins and Minerals
biology|6.3|communicable-diseases|Communicable Diseases
biology|6.4|kerala-health-welfare|Kerala Health and Welfare
biology|6.5|lifestyle-diseases|Lifestyle Diseases
biology|6.6|basic-health|Basic Health
biology|6.7|environment|Environment
biology|6.8|environmental-hazards|Environmental Hazards
physics|7.1|basic-physics|Basic Physics
physics|7.2|motion|Motion
physics|7.3|light|Light
physics|7.4|sound|Sound
physics|7.5|force|Force
physics|7.6|gravitation|Gravitation
physics|7.7|heat|Heat
physics|7.8|work-energy-power|Work Energy Power
physics|7.9|electronics|Electronics
chemistry|8.1|atom|Atom
chemistry|8.2|molecule|Molecule
chemistry|8.3|states-of-matter|States of Matter
chemistry|8.4|allotropy|Allotropy
chemistry|8.5|gas-laws|Gas Laws
chemistry|8.6|aqua-regia|Aqua Regia
chemistry|8.7|elements|Elements
chemistry|8.8|periodic-table|Periodic Table
chemistry|8.9|metals-non-metals|Metals and Non-Metals
chemistry|8.10|chemical-physical-changes|Chemical and Physical Changes
chemistry|8.11|chemical-reactions|Chemical Reactions
chemistry|8.12|solutions|Solutions
chemistry|8.13|mixtures|Mixtures
chemistry|8.14|compounds|Compounds
chemistry|8.15|alloys|Alloys
chemistry|8.16|acids|Acids
chemistry|8.17|bases-alkalis|Bases and Alkalis
chemistry|8.18|ph|pH
chemistry|8.19|alkaloids|Alkaloids
art-sports-literature|9.1|art-culture|Art and Culture
art-sports-literature|9.2|sports|Sports
art-sports-literature|9.3|literature|Literature
art-sports-literature|9.4|culture|Culture
computer|10.1|hardware|Hardware
computer|10.2|software-os|Software and OS
computer|10.3|networks|Networks
computer|10.4|internet|Internet
computer|10.5|html-other|HTML and Other
computer|10.6|cyber-crimes|Cyber Crimes and Laws
arithmetic|11.1|numbers|Numbers
arithmetic|11.2|fractions|Fractions
arithmetic|11.3|decimals|Decimals
arithmetic|11.4|percentage|Percentage
arithmetic|11.5|profit-loss|Profit and Loss
arithmetic|11.6|simple-interest|Simple Interest
arithmetic|11.7|compound-interest|Compound Interest
arithmetic|11.8|ratio-proportion|Ratio and Proportion
arithmetic|11.9|time-distance|Time and Distance
arithmetic|11.10|time-work|Time and Work
arithmetic|11.11|average|Average
arithmetic|11.12|exponents|Exponents
arithmetic|11.13|mensuration|Mensuration
arithmetic|11.14|perimeter|Perimeter
arithmetic|11.15|area|Area
arithmetic|11.16|volume|Volume
arithmetic|11.17|progressions|Progressions
arithmetic|11.20|geometry|Geometry
arithmetic|11.21|trigonometry|Trigonometry
mental-ability|12.1|number-series|Number Series
mental-ability|12.2|alphabet-series|Alphabet Series
mental-ability|12.3|mathematical-signs|Mathematical Signs
mental-ability|12.4|position-test|Position Test
mental-ability|12.5|word-analogy|Word Analogy
mental-ability|12.6|alphabet-analogy|Alphabet Analogy
mental-ability|12.7|number-analogy|Number Analogy
mental-ability|12.8|odd-one-out|Odd One Out
mental-ability|12.9|numerical-reasoning|Numerical Reasoning
mental-ability|12.10|coding-decoding|Coding and Decoding
mental-ability|12.11|family-relations|Family Relations
mental-ability|12.12|direction-sense|Direction Sense
mental-ability|12.13|clock-time|Clock Time and Angles
mental-ability|12.14|mirror-image|Mirror Image
mental-ability|12.15|calendar|Calendar and Dates
mental-ability|12.16|clerical-ability|Clerical Ability
english|13.1.1|types-of-sentences|Types of Sentences
english|13.1.2|interchange|Interchange
english|13.1.3|parts-of-speech|Parts of Speech
english|13.1.4|subject-verb-agreement|Subject-Verb Agreement
english|13.1.5|articles|Articles
english|13.1.6|primary-auxiliaries|Primary Auxiliaries
english|13.1.7|modal-auxiliaries|Modal Auxiliaries
english|13.1.8|question-tags|Question Tags
english|13.1.9|infinitives|Infinitives
english|13.1.10|gerunds|Gerunds
english|13.1.11|tenses|Tenses
english|13.1.12|conditional-sentences|Conditional Sentences
english|13.1.13|prepositions|Prepositions
english|13.1.14|correlatives|Correlatives
english|13.1.15|direct-indirect-speech|Direct and Indirect Speech
english|13.1.16|active-passive-voice|Active and Passive Voice
english|13.1.17|sentence-correction|Sentence Correction
english|13.1.18|degrees-of-comparison|Degrees of Comparison
english|13.2.1|singular-plural|Singular and Plural
english|13.2.2|gender|Gender
english|13.2.3|collective-nouns|Collective Nouns
english|13.2.4|word-formation|Word Formation
english|13.2.5|prefix-suffix|Prefix and Suffix
english|13.2.6|compound-words|Compound Words
english|13.2.7|synonyms|Synonyms
english|13.2.8|antonyms|Antonyms
english|13.2.9|phrasal-verbs|Phrasal Verbs
english|13.2.10|foreign-words|Foreign Words and Phrases
english|13.2.11|one-word-substitutes|One-Word Substitutes
english|13.2.12|confusing-words|Confusing Words
english|13.2.13|spelling|Spelling
english|13.2.14|idioms|Idioms
malayalam|14.2|padashuddhi|Padashuddhi
malayalam|14.3|vakyashuddhi|Vakyashuddhi
malayalam|14.4|paribhasha|Paribhasha
malayalam|14.5|ottapadam|Ottapadam
malayalam|14.6|paryayam|Paryayam
malayalam|14.7|vipareethapadam|Vipareethapadam
malayalam|14.8|shailikal|Shailikal
malayalam|14.9|pazhanchollukal|Pazhanchollukal
malayalam|14.10|samanapadam|Samanapadam
malayalam|14.11|cherthezhuthuka|Cherthezhuthuka
malayalam|14.12|streelingam|Streelingam
malayalam|14.13|pullingam|Pullingam
malayalam|14.14|vachanam|Vachanam
malayalam|14.15|pirichezhuthal|Pirichezhuthal
current-affairs|15.1.1|national-affairs|National Affairs
current-affairs|15.1.2|international-affairs|International Affairs
current-affairs|15.1.3|kerala-affairs|Kerala Affairs
current-affairs|15.1.4|science-technology|Science and Technology
current-affairs|15.1.5|awards-sports|Awards Sports Culture
current-affairs|15.1.6|govt-schemes|Government Schemes
important-acts|16.1.1|rti-act-2005|RTI Act 2005
important-acts|16.1.2|rti-definitions|RTI Definitions
important-acts|16.1.3|exempted-information|Exempted Information
important-acts|16.1.4|third-party-information|Third-Party Information
important-acts|16.1.5|information-commissions|Information Commissions
important-acts|16.1.6|rti-powers-functions|RTI Powers and Functions
important-acts|16.2.1|kerala-right-service-act|Kerala Right to Service Act 2012
important-acts|16.2.2|rps-definitions|RPS Definitions
important-acts|16.2.3|statutory-framework|Statutory Framework
important-acts|16.2.4|redressal|Redressal
important-acts|16.2.5|rps-appeals|Appeals
important-acts|16.2.6|rps-penalties|Penalties
important-acts|16.3.1|consumer-protection-act-2019|Consumer Protection Act 2019
important-acts|16.3.2|consumer-rights|Consumer Rights
important-acts|16.3.3|consumer-protection-councils|Consumer Protection Councils
important-acts|16.3.4|consumer-protection-authority|Consumer Protection Authority
important-acts|16.3.5|dispute-redressal-commissions|Dispute Redressal Commissions
important-acts|16.3.6|consumer-mediation|Consumer Mediation
important-acts|16.3.7|product-liability|Product Liability
important-acts|16.3.8|consumer-offences-penalties|Offences and Penalties
important-acts|16.4.1|protection-civil-rights-act|Protection of Civil Rights Act 1955
important-acts|16.4.2|sc-st-atrocities-act|SC ST Prevention of Atrocities Act 1989
important-acts|16.4.3|kerala-sc-st-commission-act|Kerala SC ST Commission Act 2007
important-acts|16.4.4|kerala-sc-st-commission|Kerala State SC ST Commission
important-acts|16.4.5|protection-human-rights-act|Protection of Human Rights Act 1993
important-acts|16.4.6|nhrc|National Human Rights Commission
important-acts|16.4.7|shrc|State Human Rights Commission
important-acts|16.4.8|senior-citizens-act|Senior Citizens Act 2007
important-acts|16.4.9|rpwd-act|RPwD Act 2016
important-acts|16.4.10|transgender-persons-act|Transgender Persons Act 2019
important-acts|16.5.1|bns-offences-women|BNS Offences Against Women
important-acts|16.5.2|dowry-prohibition-act|Dowry Prohibition Act 1961
important-acts|16.5.3|ncw-act|National Commission for Women Act
important-acts|16.5.4|kerala-womens-commission|Kerala Womens Commission Act
important-acts|16.5.5|domestic-violence-act|Domestic Violence Act 2005
important-acts|16.5.6|posh-act|POSH Act 2013
important-acts|16.6.1|bns-offences-children|BNS Offences Against Children
important-acts|16.6.2|pocso-act|POCSO Act 2012
important-acts|16.6.3|juvenile-justice-act|Juvenile Justice Act 2015
important-acts|16.6.4|jj-board|JJ Board
important-acts|16.6.5|child-welfare-committee|Child Welfare Committee
important-acts|16.6.6|child-procedures|Procedures
important-acts|16.7.1|prevention-corruption-act|Prevention of Corruption Act 1988
important-acts|16.7.2|cvc-act|Central Vigilance Commission Act 2003
important-acts|16.7.3|lokpal-lokayuktas-act|Lokpal and Lokayuktas Act 2013
important-acts|16.7.4|kerala-lok-ayukta-act|Kerala Lok Ayukta Act 1999
important-acts|16.8.1|public-servant-bns|Public Servant under BNS
important-acts|16.8.2|offences-public-servants|Offences By and Against Public Servants
important-acts|16.9.1|administrative-tribunals-act|Administrative Tribunals Act 1985
important-acts|16.9.2|cat|Central Administrative Tribunal
important-acts|16.9.3|kat|Kerala Administrative Tribunal
special-topics|17.1.1|intl-national-standards|International and National Standards
special-topics|17.1.2|intl-organisations-labs|International Organisations and Laboratories
special-topics|17.1.3|measuring-equipment|Measuring Equipment
special-topics|17.1.4|measurement-concepts|Measurement Concepts
special-topics|17.2.1|lm-sec-17|Legal Metrology Section 17
special-topics|17.2.2|lm-sec-18|Legal Metrology Section 18
special-topics|17.2.3|lm-sec-22|Legal Metrology Section 22
special-topics|17.2.4|lm-sec-24|Legal Metrology Section 24
special-topics|17.2.5|lm-sec-25|Legal Metrology Section 25
special-topics|17.2.6|lm-sec-26|Legal Metrology Section 26
special-topics|17.2.7|lm-sec-27|Legal Metrology Section 27
special-topics|17.2.8|lm-sec-31|Legal Metrology Section 31
special-topics|17.2.9|lm-sec-33|Legal Metrology Section 33
special-topics|17.2.10|lm-sec-34|Legal Metrology Section 34
special-topics|17.2.11|lm-sec-36|Legal Metrology Section 36
special-topics|17.2.12|lm-sec-44|Legal Metrology Section 44
special-topics|17.3.1|pcr-rule-6|Packaged Commodity Rule 6
special-topics|17.3.2|pcr-rule-7|Packaged Commodity Rule 7
special-topics|17.3.3|pcr-rule-8|Packaged Commodity Rule 8
special-topics|17.3.4|pcr-rule-10|Packaged Commodity Rule 10
special-topics|17.4.1|kerala-rule-14|Kerala Enforcement Rule 14
special-topics|17.4.2|kerala-rule-15|Kerala Enforcement Rule 15
special-topics|17.4.3|kerala-rule-16|Kerala Enforcement Rule 16
special-topics|17.4.4|kerala-rule-17|Kerala Enforcement Rule 17
special-topics|17.4.5|kerala-rule-22|Kerala Enforcement Rule 22
special-topics|17.4.6|kerala-rule-23|Kerala Enforcement Rule 23
special-topics|17.4.7|kerala-rule-24|Kerala Enforcement Rule 24
'@

$topics = ($topicData -split "`r?`n") | Where-Object { $_.Trim() -ne '' }

$stubTemplate = @'
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>__TID__ __TITLE__ - Kerala PSC</title>
<link rel="stylesheet" href="../../assets/css/app.css">
</head>
<body>

<header class="topbar">
  <div class="brand">__TID__ __TITLE__</div>
  <div class="tabs" id="tabs">
    <button data-view="notes" class="active">Notes</button>
    <button data-view="test">Practice</button>
    <button data-view="result">Result</button>
    <button data-view="bookmarks">Bookmarks</button>
    <button data-view="revision">Revision</button>
    <button data-view="search">Search</button>
  </div>
</header>

<div class="scorebar">
  <div class="sbitem"><span>Net</span><b id="sbScore">0.00 / 0</b></div>
  <div class="sbitem"><span>Attempted</span><b id="sbAtt">0</b></div>
  <div class="sbitem"><span>Correct</span><b id="sbCor">0</b></div>
  <div class="sbitem"><span>Wrong</span><b id="sbWr">0</b></div>
  <div class="sbitem"><span>Remaining</span><b id="sbRem">0</b></div>
  <div class="sbitem"><span>Accuracy</span><b id="sbAcc">0.0%</b></div>
</div>
<div class="progresswrap"><div class="progressbar" id="progressbar"></div></div>

<main>

<section class="view active" id="view-notes">
  <div class="viewhead">
    <h2>__TID__ __TITLE__</h2>
    <p class="hint">Notes coming soon. Meanwhile, practise questions in the Practice tab.</p>
  </div>
</section>

<section class="view" id="view-test">
  <div class="toolbar">
    <div class="filters">
      <span class="flabel">Category:</span>
      <button class="chip active" data-cat="ALL">All</button>
      <button class="chip" data-cat="573">573</button>
      <button class="chip" data-cat="883">883</button>
    </div>
    <div class="tools">
      <select id="topicFilter"><option value="ALL">All Topics</option></select>
      <select id="diffFilter">
        <option value="ALL">All Difficulty</option>
        <option value="Easy">Easy</option>
        <option value="Medium">Medium</option>
        <option value="Hard">Hard</option>
        <option value="Very Hard">Very Hard</option>
      </select>
      <label class="flabel">Neg:
        <input type="number" id="negInput" step="0.01" min="0" value="0.33" style="width:70px">
      </label>
      <button class="btn ghost" id="resetBtn">Reset</button>
      <button class="btn primary" id="finishBtn">Finish</button>
    </div>
  </div>
  <div class="qcard" id="qcard"></div>
  <div class="navwrap">
    <h4>Question Navigator</h4>
    <div class="navgrid" id="navgrid"></div>
    <div id="setInfo" class="hint" style="margin-top:.6rem"></div>
  </div>
</section>

<section class="view" id="view-result"><div id="resultHost"></div></section>

<section class="view" id="view-bookmarks">
  <div class="viewhead"><h2>Bookmarks</h2></div>
  <div id="bookmarkList"></div>
</section>

<section class="view" id="view-revision">
  <div class="viewhead"><h2>Revision Mode</h2></div>
  <div class="setgrid" id="setgrid"></div>
</section>

<section class="view" id="view-search">
  <div class="viewhead"><h2>Search</h2></div>
  <div class="searchbox">
    <input type="search" id="searchInput" placeholder="Search...">
    <button class="btn ghost" id="clearSearch">Clear</button>
  </div>
  <div id="searchResults"></div>
</section>

</main>

<script>
window.PART_KEY   = '__KEY__';
window.PART_TITLE = '__TID__ __TITLE__';
window.QUESTIONS  = [];
</script>
<script src="../../assets/js/engine.js"></script>

</body>
</html>
'@

$created = 0
$skipped = 0
$filesEntries = @()

foreach ($line in $topics) {
  $p = $line.Split('|')
  $folder = $p[0]; $tid = $p[1]; $slug = $p[2]; $title = $p[3]
  $key = "$folder-$tid-$slug"
  $file = "$tid-$slug.html"
  $dir = Join-Path $root "topics\$folder"

  if (-not (Test-Path $dir)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
  }

  $path = Join-Path $dir $file

  if (Test-Path $path) {
    Write-Host "  SKIP  topics\$folder\$file" -ForegroundColor DarkGray
    $skipped++
  } else {
    $stub = $stubTemplate.Replace('__TID__', $tid).Replace('__TITLE__', $title).Replace('__KEY__', $key)
    [System.IO.File]::WriteAllText($path, $stub, $utf8)
    Write-Host "  NEW   topics\$folder\$file" -ForegroundColor Green
    $created++
  }

  $filesEntries += "  `"$tid`": { file: `"topics/$folder/$file`", key: `"$key`", qs: 0 }"
}

$filesLines = @()
$filesLines += 'const FILES = {'
$filesLines += '  // Existing (already built):'
$filesLines += '  "2.3.1": { file: "topics/geography/2.3.1-physiography.html", key: "geography-2.3.1-physiography", qs: 15 },'
$filesLines += '  "2.3.2": { file: "topics/geography/2.3.2-districts.html",    key: "geography-2.3.2-districts",    qs: 20 },'
$filesLines += '  "2.3.4": { file: "topics/geography/2.3.3-climate.html",      key: "geography-2.3.3-climate",      qs: 15 },'
$filesLines += ''
$filesLines += '  // Auto-generated topic stubs (set qs after adding questions):'
$filesLines += ($filesEntries -join ",`r`n")
$filesLines += '};'

$filesOut = Join-Path $root '_FILES-block.txt'
[System.IO.File]::WriteAllText($filesOut, ($filesLines -join "`r`n"), $utf8)

Write-Host ''
Write-Host '=================================' -ForegroundColor Cyan
Write-Host "Created : $created new topic stubs" -ForegroundColor Green
Write-Host "Skipped : $skipped (already existed)" -ForegroundColor DarkGray
Write-Host "FILES   : _FILES-block.txt" -ForegroundColor Yellow
Write-Host ''
Write-Host 'NEXT STEPS:' -ForegroundColor Yellow
Write-Host '  1. Open _FILES-block.txt'
Write-Host '  2. Copy the entire content'
Write-Host '  3. Open assets/js/syllabus.js'
Write-Host '  4. Find the FILES block'
Write-Host '  5. Replace with the copied content'
Write-Host '  6. Save + hard-refresh browser'
Write-Host ''
Read-Host 'Press Enter to close'