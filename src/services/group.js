// ✅ versi stabil: identifikasi pengirim via getContact()
const digits = (s='') => String(s).replace(/\D/g, '');

const logOnce = new Set();

export async function isSenderAdminInThisGroup(msg, chat) {
  if (!chat?.isGroup) return false;

  // Dapatkan contact pengirim pesan (bekerja untuk grup & non-grup)
  const contact = await msg.getContact();
  const senderId = contact?.id?._serialized; // mis. "62812xxxx@c.us"
  if (!senderId) return false;

  const p = chat.participants?.find?.(x => {
    const pid = x?.id?._serialized || x?.id;
    return pid === senderId || digits(pid) === digits(senderId);
  });
  return !!(p?.isAdmin || p?.isSuperAdmin);
}

export async function isSelfAdminInThisGroup(client, chat) {
  const selfRaw = client?.info?.wid?._serialized || client?.sock?.user?.id || '';
  const selfDigits = digits(selfRaw);

  const checkList = (participants=[]) => {
    const me = participants.find(x => digits(x?.id?._serialized || x?.id) === selfDigits);
    if (!me) return false;
    const adminFlag = me.isAdmin || me.isSuperAdmin || me.admin === 'admin' || me.admin === 'superadmin';
    return !!adminFlag;
  };

  // Prefer fresh metadata from socket for accurate admin flag
  try {
    const gid = chat?.id?._serialized || chat?.id;
    if (client?.getGroupMeta && gid) {
      const meta = await client.getGroupMeta(gid);
      if (checkList(meta?.participants || [])) return true;
      // debug once per group to help diagnose
      const key = `${gid}:${selfDigits}`;
      if (!logOnce.has(key)) {
        logOnce.add(key);
        const sample = (meta?.participants || []).slice(0, 5).map(p => ({ id: p.id, admin: p.admin || p.isAdmin || p.isSuperAdmin }));
        console.warn('[AdminCheck] self not found as admin. self=', selfRaw, 'digits=', selfDigits, 'group=', gid, 'sample=', sample);
      }
    }
  } catch {}

  // Fallback to cached chat participants
  if (checkList(chat?.participants || [])) return true;

  return false;
}


/** adminsOnly = true => hanya admin boleh kirim (CLOSE) */
export async function setGroupSendMode(client, chat, adminsOnly) {
  if (typeof chat.setMessagesAdminsOnly === 'function') {
    await chat.setMessagesAdminsOnly(!!adminsOnly);
    return;
  }
  if (typeof client.groupSettingUpdate === 'function') {
    const chatId = chat?.id?._serialized || chat?.id;
    await client.groupSettingUpdate(chatId, adminsOnly ? 'announcement' : 'not_announcement');
    return;
  }
  throw new Error('API untuk ubah mode kirim pesan grup tidak ditemukan.');
}

/** Helper ringkas: validasi di #h */
export async function assertGroupAndAdmin(msg) {
  const chat = await msg.getChat();
  if (!chat?.isGroup) return { ok: false, reason: 'not_group', chat };
  const senderIsAdmin = await isSenderAdminInThisGroup(msg, chat);
  if (!senderIsAdmin) return { ok: false, reason: 'not_admin', chat };
  return { ok: true, chat };
}

