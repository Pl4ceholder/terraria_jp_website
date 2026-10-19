// ==========================================================================
// achievements.js — マイページに出す「自分の実績」の、取り込み方と引き方
//
// Discord の bot から届く形を、保存できる形に整える（toAchievementRows）のと、
// 自分のぶんを引く SQL（ACHIEVEMENT_LIST_SQL）を 1 か所に置く。
//
// 取り込みの整え方を index.js ではなくここに置いているのは、手元で確かめるため。
// scripts/check-achievements.mjs が、この 2 つをそのまま読んで試す。
//
// 実績の「解放済み」は Discord のロールには出ない（ロールは、いまつけている称号 1 つだけ）。
// そのため中身は bot から届いた写しで、届いた内容で丸ごと入れ替える。
// ==========================================================================

/** 一度に受け取る実績の数（Discord 側の定義は、いまのところ数件） */
export const ACHIEVEMENT_MAX = 20;

/** 一度に受け取る人数。増えすぎたら断る（断っても、前の内容は残る） */
export const ACHIEVEMENT_MEMBERS_MAX = 500;

/** 実績の名前の長さ（Discord のロール名は 100 文字まで） */
export const ACHIEVEMENT_NAME_MAX = 100;

/**
 * Discord の bot から届いた内容を、保存できる形に整える。
 *
 *   { guildId, achievements: [{ id, name }], members: [{ userId, unlocked: [], title }] }
 *
 * 実績の一覧に無い ID（消えたロールなど）は入れない。同じ人が何度も出てきても 1 行にする。
 */
export const toAchievementRows = (payload, syncedAt) => {
    const master = Array.isArray(payload?.achievements) ? payload.achievements : null;
    const members = Array.isArray(payload?.members) ? payload.members : null;

    if (!master) return { error: "実績の一覧が入っていません。" };
    if (!members) return { error: "誰が何を解放したかが入っていません。" };

    const guildId = trimTo(payload?.guildId, 32);
    if (!guildId) return { error: "Discord のサーバー ID が入っていません。" };
    if (master.length > ACHIEVEMENT_MAX) {
        return { error: `実績は一度に ${ACHIEVEMENT_MAX} 件までです。` };
    }
    if (members.length > ACHIEVEMENT_MEMBERS_MAX) {
        return { error: `実績を持つ人は一度に ${ACHIEVEMENT_MEMBERS_MAX} 人までです。` };
    }

    const rowsMaster = [];
    const known = new Set();

    master.forEach((item, index) => {
        const id = trimTo(item?.id, 32);
        if (!id || known.has(id)) return;
        known.add(id);

        rowsMaster.push({
            id,
            name: trimTo(item?.name, ACHIEVEMENT_NAME_MAX),
            position: index,
            syncedAt,
        });
    });

    const rowsMembers = [];
    const seen = new Set();

    for (const item of members) {
        const userId = trimTo(item?.userId, 32);
        if (!userId || seen.has(userId)) continue;
        seen.add(userId);

        const title = trimTo(item?.title, 32);
        const list = Array.isArray(item?.unlocked) ? item.unlocked : [];

        // 実績の一覧にあるものだけを、重複なく、Discord の並び順で持つ
        const unlocked = [];
        for (const row of rowsMaster) {
            if (list.some((value) => trimTo(value, 32) === row.id)) unlocked.push(row.id);
        }

        rowsMembers.push({
            userId,
            unlocked: unlocked.join(","),
            // 称号は、解放済みのものしか付けられない（食い違っていたら付けていない扱い）
            title: unlocked.includes(title) ? title : "",
            syncedAt,
        });
    }

    return { data: { master: rowsMaster, members: rowsMembers } };
};

/**
 * 自分の実績を、Discord 側の並び順で引く。
 *
 *   ?1 …… 見ている人の Discord のユーザー ID
 *
 * 解放済みかどうかは、カンマでつないだ文字列を前後のカンマごと比べて見る。
 * こうしないと「11」が「111」に当たってしまう。
 */
export const ACHIEVEMENT_LIST_SQL = `
    SELECT a.id, a.name,
           COALESCE((',' || m.unlocked || ',') LIKE ('%,' || a.id || ',%'), 0) AS unlocked,
           COALESCE(m.title = a.id, 0) AS worn
      FROM achievements a
      LEFT JOIN member_achievements m ON m.user_id = ?1
     ORDER BY a.position, a.id
`;

/** 文字列を、長さを切って整える */
const trimTo = (value, max) =>
    String(value ?? "")
        .trim()
        .slice(0, max);
