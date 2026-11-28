try {
  document.documentElement.dataset.theme =
    localStorage.getItem('iot_monitoring_theme') === 'dark' ? 'dark' : 'light'
} catch {
  document.documentElement.dataset.theme = 'light'
}
