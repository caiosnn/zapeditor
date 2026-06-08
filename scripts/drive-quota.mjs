// Mostra a quota do Google Drive da conta conectada (pra dimensionar o arquivamento em massa).
import { google } from 'googleapis'
import { getAuthClient } from '../src/drive.js'

const auth = await getAuthClient()
const drive = google.drive({ version: 'v3', auth })
const r = await drive.about.get({ fields: 'storageQuota,user' })
const q = r.data.storageQuota
const gb = (n) => (Number(n) / 1e9).toFixed(1)
console.log('conta:', r.data.user?.emailAddress)
console.log('limite:', q.limit ? gb(q.limit) + ' GB' : 'ilimitado (Workspace?)')
console.log('em uso:', gb(q.usage) + ' GB')
if (q.limit) console.log('livre :', gb(Number(q.limit) - Number(q.usage)) + ' GB')
