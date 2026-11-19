$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
[Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime] | Out-Null
[Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime] | Out-Null
function Await-Operation($Operation, $ResultType) {
  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
  $task = $method.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
  $task.Wait()
  return $task.Result
}
$sampleDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../docs/samples'))
$pageCounts = @()
foreach ($file in Get-ChildItem -LiteralPath $sampleDir -Filter '*.pdf') {
  $storage = Await-Operation ([Windows.Storage.StorageFile]::GetFileFromPathAsync($file.FullName)) ([Windows.Storage.StorageFile])
  $pdf = Await-Operation ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($storage)) ([Windows.Data.Pdf.PdfDocument])
  $pageCounts += @{name=$file.BaseName; pages=$pdf.PageCount}
  for ($i=0; $i -lt $pdf.PageCount; $i++) {
    $page = $pdf.GetPage($i)
    $stream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
    $action = $page.RenderToStreamAsync($stream)
    $method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and !$_.IsGenericMethod -and $_.GetParameters().Count -eq 1 } | Select-Object -First 1
    $method.Invoke($null,@($action)).Wait()
    $reader = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream)
    $output = [IO.File]::Create((Join-Path $sampleDir ($file.BaseName+'-'+($i+1)+'.png')))
    try { $reader.CopyTo($output) } finally { $output.Dispose(); $reader.Dispose(); $page.Dispose() }
  }
}
$pageCounts | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $sampleDir 'print-pages.json')
$pageCounts | ConvertTo-Json
