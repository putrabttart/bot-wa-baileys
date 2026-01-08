// ✅ versi stabil: identifikasi pengirim via getContact()
const digits = (s='') => String(s).replace(/\D/g, '');

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
  const selfId = client?.info?.wid?._serialized;
  const me = chat.participants?.find?.(x => {
    const pid = x?.id?._serialized || x?.id;
    return pid === selfId || digits(pid) === digits(selfId);
  });
  return !!(me?.isAdmin || me?.isSuperAdmin);
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

