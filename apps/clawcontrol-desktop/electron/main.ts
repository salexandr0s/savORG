import { app, BrowserWindow, Menu } from 'electron'
import path from 'node:path'
import { getAssetPath, isDev } from './utils'

let mainWindow: BrowserWindow | null = null

function createAppMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools', visible: isDev() },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'About ClawControl',
          click: () => {
            app.showAboutPanel()
          },
        },
      ],
    },
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

function createMainWindow() {
  const preloadPath = path.join(__dirname, 'preload.js')
  const windowIcon = process.platform === 'win32'
    ? getAssetPath('icon.ico')
    : getAssetPath('icon.png')

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: windowIcon,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: preloadPath,
    },
  })

  mainWindow.loadURL('http://127.0.0.1:3000')

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.on('ready', () => {
  createAppMenu()
  createMainWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow()
  }
})
