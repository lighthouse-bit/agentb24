param([string]$SiteUrl = 'https://agentb24.com', [string]$LastModified = '2026-06-28')

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$utf8 = New-Object System.Text.UTF8Encoding($false)
$public = Get-ChildItem $root -Recurse -Filter *.html | Where-Object { $_.Name -ne 'admin.html' }

function PlainText([string]$html) {
  return [Net.WebUtility]::HtmlDecode(([regex]::Replace($html, '<[^>]+>', '')).Trim())
}

# Map each tool to the first category hub that links to it.
$hubMap = @{}
Get-ChildItem (Join-Path $root 'tools') -Filter '*tools.html' | ForEach-Object {
  $hub = $_
  $raw = [IO.File]::ReadAllText($hub.FullName)
  $h1 = [regex]::Match($raw, '<h1[^>]*>(.*?)</h1>', 'IgnoreCase,Singleline')
  $hubTitle = if ($h1.Success) { PlainText $h1.Groups[1].Value } else { $hub.BaseName -replace '-', ' ' }
  foreach ($match in [regex]::Matches($raw, 'href=["'']([^"'']+\.html)["'']', 'IgnoreCase')) {
    $target = [IO.Path]::GetFileName($match.Groups[1].Value)
    if (-not $hubMap.ContainsKey($target)) { $hubMap[$target] = @($hub.Name, $hubTitle) }
  }
}

foreach ($file in $public) {
  $html = [IO.File]::ReadAllText($file.FullName)
  # Remove only the previously generated pack before inspecting specialized
  # schemas that belong to the page itself.
  $html = [regex]::Replace($html, '\s*<!-- AgentB24 SEO Pack -->[\s\S]*?<!-- /AgentB24 SEO Pack -->\s*', '', 'IgnoreCase')
  $relative = $file.FullName.Substring($root.Length).TrimStart('\').Replace('\', '/')
  $url = if ($file.Name -eq 'index.html') { "$SiteUrl/" } else { "$SiteUrl/$relative" }

  $html = $html.Replace('https://www.AgentB24.com', $SiteUrl)
  $html = $html.Replace('https://www.agentb24.com', $SiteUrl)
  $html = $html.Replace('/assets/img/og-image.jpg', '/assets/img/og-image.png')
  $html = [regex]::Replace(
    $html,
    '(<link\b[^>]*rel=["'']canonical["''][^>]*href=["''])[^"'']+(["''])',
    ('$1' + $url + '$2'),
    'IgnoreCase'
  )

  $titleMatch = [regex]::Match($html, '<title[^>]*>(.*?)</title>', 'IgnoreCase,Singleline')
  $title = PlainText $titleMatch.Groups[1].Value
  $descriptionMatch = [regex]::Match($html, '<meta\b[^>]*name=["'']description["''][^>]*content=["'']([^"'']*)["'']', 'IgnoreCase,Singleline')
  $description = if ($descriptionMatch.Success) { [Net.WebUtility]::HtmlDecode($descriptionMatch.Groups[1].Value.Trim()) } else { 'Free browser-based utility from AgentB24.' }
  $h1Match = [regex]::Match($html, '<h1[^>]*>(.*?)</h1>', 'IgnoreCase,Singleline')
  $pageName = if ($h1Match.Success) { PlainText $h1Match.Groups[1].Value } else { ($title -replace '\s*[|—-]\s*AgentB24.*$', '').Trim() }

  # Keep one normalized set of social and crawler metadata.
  $html = [regex]::Replace(
    $html,
    '<meta\b[^>]*(?:property\s*=\s*["'']og:[^"'']+|name\s*=\s*["''](?:twitter:[^"'']+|author|robots|theme-color))[^>]*>\s*',
    '',
    'IgnoreCase'
  )

  $encodedTitle = [Net.WebUtility]::HtmlEncode($title)
  $encodedDescription = [Net.WebUtility]::HtmlEncode($description)
  $pack = @"

  <!-- AgentB24 SEO Pack -->
  <meta name="author" content="AgentB24">
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
  <meta name="theme-color" content="#4F46E5">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="AgentB24">
  <meta property="og:locale" content="en_US">
  <meta property="og:url" content="$url">
  <meta property="og:title" content="$encodedTitle">
  <meta property="og:description" content="$encodedDescription">
  <meta property="og:image" content="$SiteUrl/assets/img/og-image.png">
  <meta property="og:image:width" content="1718">
  <meta property="og:image:height" content="912">
  <meta property="og:image:alt" content="AgentB24 — 80+ Free Online Tools">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="$encodedTitle">
  <meta name="twitter:description" content="$encodedDescription">
  <meta name="twitter:image" content="$SiteUrl/assets/img/og-image.png">

"@

  $schemas = @()
  if ($file.Name -eq 'index.html') {
    $schemas += @{'@context'='https://schema.org';'@type'='Organization';name='AgentB24';url="$SiteUrl/";logo="$SiteUrl/assets/img/favicon.png"}
  } elseif ($file.Name -eq 'about.html') {
    $schemas += @{'@context'='https://schema.org';'@type'='AboutPage';name=$pageName;url=$url;description=$description}
  } elseif ($file.Name -eq 'privacy-policy.html') {
    $schemas += @{'@context'='https://schema.org';'@type'='WebPage';name=$pageName;url=$url;description=$description}
  } elseif ($file.Directory.Name -eq 'tools') {
    $isHub = $file.Name -like '*tools.html' -or $file.Name -in @('calculators.html','converters.html')
    if ($isHub) {
      if ($html -notmatch '"@type"\s*:\s*"CollectionPage"') {
        $schemas += @{'@context'='https://schema.org';'@type'='CollectionPage';name=$pageName;url=$url;description=$description;isPartOf=@{'@type'='WebSite';name='AgentB24';url="$SiteUrl/"}}
      }
    } elseif ($html -notmatch '"@type"\s*:\s*"WebApplication"') {
      $schemas += @{'@context'='https://schema.org';'@type'='WebApplication';name=$pageName;url=$url;description=$description;applicationCategory='UtilityApplication';operatingSystem='Any';browserRequirements='Requires JavaScript and a modern web browser';offers=@{'@type'='Offer';price='0';priceCurrency='USD'};publisher=@{'@type'='Organization';name='AgentB24';url="$SiteUrl/"}}
    }

    if ($html -notmatch '"@type"\s*:\s*"BreadcrumbList"') {
      $category = if ($hubMap.ContainsKey($file.Name)) { $hubMap[$file.Name] } else { @('', 'Tools') }
      $items = @(@{'@type'='ListItem';position=1;name='Home';item="$SiteUrl/"})
      if ($category[0]) {
        $items += @{'@type'='ListItem';position=2;name=$category[1];item="$SiteUrl/tools/$($category[0])"}
        $position = 3
      } else { $position = 2 }
      $items += @{'@type'='ListItem';position=$position;name=$pageName;item=$url}
      $schemas += @{'@context'='https://schema.org';'@type'='BreadcrumbList';itemListElement=$items}
    }
  }

  foreach ($schema in $schemas) {
    $json = $schema | ConvertTo-Json -Depth 8 -Compress
    $pack += "  <script type=`"application/ld+json`">$json</script>`r`n"
  }
  $pack += "  <!-- /AgentB24 SEO Pack -->`r`n"

  if ($html.Contains('<!-- AgentB24 SEO Pack -->')) {
    $html = [regex]::Replace($html, '\s*<!-- AgentB24 SEO Pack -->[\s\S]*?<!-- /AgentB24 SEO Pack -->\s*', $pack, 'IgnoreCase')
  } else {
    $html = $html.Replace('</head>', $pack + '</head>')
  }
  [IO.File]::WriteAllText($file.FullName, $html, $utf8)
}

$sitemapPath = Join-Path $root 'sitemap.xml'
$sitemap = [IO.File]::ReadAllText($sitemapPath)
$sitemap = [regex]::Replace($sitemap, '<lastmod>[^<]+</lastmod>', '')
$sitemap = $sitemap.Replace('</loc><priority>', "</loc><lastmod>$LastModified</lastmod><priority>")
[IO.File]::WriteAllText($sitemapPath, $sitemap, $utf8)

Write-Output "SEO pack applied to $($public.Count) public pages."
