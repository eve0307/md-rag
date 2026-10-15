[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
$paths = @()
if ($env:RAG_PICK_KIND -eq 'files') {
 $dialog = New-Object System.Windows.Forms.OpenFileDialog
 $dialog.Filter = 'Markdown (*.md;*.markdown)|*.md;*.markdown'
 $dialog.Multiselect = $true
 if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $paths = @($dialog.FileNames) }
} else {
 $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
 $dialog.Description = 'Choose the original Markdown folder'
 if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $paths = @($dialog.SelectedPath) }
}
ConvertTo-Json -InputObject @($paths) -Compress
$dialog.Dispose()
