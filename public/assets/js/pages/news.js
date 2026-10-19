// ==========================================================================
// news.js — お知らせ（news.html）の動き
//
// 手書きのお知らせはそのままにして、その上に「これからのイベント」だけを、
// Discord から写したもの（GET /api/events）で埋める。
//
// イベントが無いとき・取れなかったときは、かたまりごと出さない（hidden のまま）。
// 通常の <script> はグローバルを共有するので、名前は外に出さない
// （CODING_RULES.md 4.1 / 4.2）。
// ==========================================================================

(() => {
    const section = document.querySelector("[data-news-events]");
    const list = document.querySelector("[data-news-events-list]");

    if (!section || !list) return;

    /** 2026-10-25T12:00:00.000Z を「10/25(土) 21:00」にする（日本時間） */
    const formatWhen = (value) => {
        const time = Date.parse(value);
        if (!Number.isFinite(time)) return "";

        return new Intl.DateTimeFormat("ja-JP", {
            timeZone: "Asia/Tokyo",
            month: "numeric",
            day: "numeric",
            weekday: "short",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        }).format(new Date(time));
    };

    /** イベント 1 件分の <li> を作る */
    const buildItem = (event) => {
        const item = document.createElement("li");
        item.className = "p-news-events__item";

        const when = document.createElement("time");
        when.className = "p-news-events__when";
        when.dateTime = event.startAt;
        when.textContent = formatWhen(event.startAt);
        item.append(when);

        const name = document.createElement("p");
        name.className = "p-news-events__name";
        name.textContent = event.name || "（名前のないイベント）";
        item.append(name);

        if (event.location) {
            const location = document.createElement("p");
            location.className = "p-news-events__location";
            location.textContent = `場所: ${event.location}`;
            item.append(location);
        }

        if (event.description) {
            const description = document.createElement("p");
            description.className = "p-news-events__description";
            description.textContent = event.description;
            item.append(description);
        }

        if (event.url) {
            const actions = document.createElement("p");
            actions.className = "p-news-events__actions";

            const link = document.createElement("a");
            link.className = "c-button c-button--small";
            link.href = event.url;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.textContent = "Discord で見る";
            actions.append(link);
            item.append(actions);
        }

        return item;
    };

    /** これからのイベントを取ってきて、1 件以上あれば出す */
    const show = async () => {
        let events = [];

        try {
            const response = await fetch("/api/events");
            const result = await response.json();
            if (Array.isArray(result.events)) events = result.events;
        } catch {
            return; // 取れなかったときは、いつもどおり出さない
        }

        if (events.length === 0) return;

        list.textContent = "";
        for (const event of events) list.append(buildItem(event));
        section.hidden = false;
    };

    show();
})();
