$ErrorActionPreference = 'Stop'
$sampleDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../docs/samples'))
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$originalPaperMapping = $null
if ($excel | Get-Member -Name MapPaperSize) { $originalPaperMapping=$excel.MapPaperSize; $excel.MapPaperSize = $false }
$book = $null
try {
  $book = $excel.Workbooks.Open((Join-Path $sampleDir 'bao-cao-mau-theo-anh.xlsx'), 0, $true)
  $sheets = @()
  foreach ($sheet in $book.Worksheets) {
    # Excel can map A4 to Letter according to the machine's printer setting.
    # Verify the actual requested paper size for this acceptance preview.
    $sheet.PageSetup.PaperSize = 9
    $pdf = Join-Path $sampleDir ($sheet.Name + '.pdf')
    $sheet.ExportAsFixedFormat(0, $pdf)
    $sheets += @{name=$sheet.Name; rows=$sheet.UsedRange.Rows.Count; columns=$sheet.UsedRange.Columns.Count; print_area=$sheet.PageSetup.PrintArea; pictures=$sheet.Shapes.Count; paper_size=$sheet.PageSetup.PaperSize}
  }
  $sheets | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $sampleDir 'excel-preview.json')
  Write-Output 'Excel opened all nine sheets and exported their print layouts to PDF.'
} finally {
  if ($null -ne $book) { $book.Close($false); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($book) }
  if ($null -ne $originalPaperMapping) { $excel.MapPaperSize=$originalPaperMapping }
  $excel.Quit()
  [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel)
}
