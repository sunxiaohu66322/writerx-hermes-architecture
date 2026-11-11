window.__ModuleLoader__.load({
  id: "@local/dsh-inkos-panel",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const react = require("react");
    const h = react.createElement;
    const useState = react.useState;
    const useEffect = react.useEffect;

    const name = "@local/dsh-inkos-panel";
    const inject = ["slots"];
    const OPEN_EVENT = "writerx:inkos:open";
    const BASE = "http://127.0.0.1:4567/api/v1";
    const CONSOLE = "http://127.0.0.1:9181/";

    /* ---------------- theme ---------------- */
    const C = {
      bg: "#0f1115",
      bar: "#171a21",
      card: "#1b1f27",
      line: "rgba(255,255,255,.09)",
      text: "#e7e9ee",
      dim: "#8b93a3",
      accent: "#6b5ce7",
      ok: "#3fb950",
      err: "#f85149",
      warn: "#d29922"
    };

    /* ---------------- shared state ---------------- */
    const listeners = new Set();
    let gExpanded = false;
    let gOpen = false;
    try {
      gExpanded = window.localStorage.getItem("inkos.panel.expanded") === "1";
    } catch (e) {}
    const notify = () => {
      listeners.forEach((fn) => {
        try {
          fn();
        } catch (e) {}
      });
    };
    const setExpanded = (v) => {
      gExpanded = v;
      try {
        window.localStorage.setItem("inkos.panel.expanded", v ? "1" : "0");
      } catch (e) {}
      notify();
    };
    const setOpen = (v) => {
      gOpen = v;
      notify();
    };
    function useGlobal() {
      const pair = useState(0);
      const bump = pair[1];
      useEffect(() => {
        const fn = () => bump((n) => n + 1);
        listeners.add(fn);
        return () => {
          listeners.delete(fn);
        };
      }, []);
      return [gExpanded, gOpen];
    }

    /* ---------------- http ---------------- */
    const encPath = (p) => p.split("/").map(encodeURIComponent).join("/");
    async function api(path, init) {
      const opt = Object.assign({}, init || {});
      opt.headers = Object.assign({ accept: "application/json" }, opt.headers || {});
      if (opt.body !== undefined && !opt.headers["content-type"]) {
        opt.headers["content-type"] = "application/json";
      }
      const res = await fetch(BASE + path, opt);
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch (e) {
        json = undefined;
      }
      if (!res.ok) {
        const detail = (json && (json.message || json.error)) || text.slice(0, 240);
        throw new Error("HTTP " + res.status + " · " + detail);
      }
      return json;
    }
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    /* ---------------- sidebar card ---------------- */
    const headStyle = {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      width: "100%",
      padding: "6px 8px",
      border: "none",
      background: "transparent",
      color: "inherit",
      cursor: "pointer",
      fontSize: "13px",
      borderRadius: "6px",
      textAlign: "left",
      fontWeight: 500
    };
    const itemStyle = {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      width: "100%",
      padding: "5px 8px",
      border: "none",
      background: "transparent",
      color: "inherit",
      cursor: "pointer",
      fontSize: "12.5px",
      borderRadius: "6px",
      textAlign: "left",
      opacity: 0.92
    };

    const ITEMS = [
      { id: "truth", icon: "🧩", label: "要素" },
      { id: "write", icon: "⚡", label: "写下一章" },
      { id: "console", icon: "🖥", label: "控制台" }
    ];

    function InkOSEntry(props) {
      const wide = props && props.wide;
      const st = useGlobal();
      const exp = st[0];

      const head = h(
        "button",
        {
          type: "button",
          "data-wide": wide || undefined,
          "aria-label": "写作车间",
          "aria-expanded": wide ? exp : undefined,
          title: "写作车间：要素 / 生成（InkOS 引擎）",
          "data-local-inkos-entry": "1",
          onClick: () => {
            if (wide) setExpanded(!exp);
            else setOpen(true);
          },
          style: headStyle
        },
        h("span", { style: { fontSize: "16px", lineHeight: 1 }, "aria-hidden": "true" }, "🖋"),
        wide ? h("span", { style: { flex: 1 } }, "写作车间") : null,
        wide ? h("span", { style: { fontSize: "10px", opacity: 0.5 } }, exp ? "▾" : "▸") : null
      );

      if (!wide || !exp) {
        return h("div", { "data-local-inkos-group": "1" }, head);
      }

      return h(
        "div",
        { "data-local-inkos-group": "1", style: { display: "flex", flexDirection: "column" } },
        head,
        h(
          "div",
          { style: { display: "flex", flexDirection: "column", paddingLeft: "16px" } },
          ITEMS.map((it) =>
            h(
              "button",
              {
                key: it.id,
                type: "button",
                onClick: () => {
                  window.__inkosPanelIntent = it.id;
                  setOpen(true);
                },
                style: itemStyle
              },
              h(
                "span",
                { style: { fontSize: "12px", width: "16px", textAlign: "center" }, "aria-hidden": "true" },
                it.icon
              ),
              h("span", null, it.label)
            )
          )
        )
      );
    }

    /* ---------------- overlay panel ---------------- */
    function InkOSOverlay() {
      const st = useGlobal();
      const open = st[1];

      const booksState = useState([]);
      const books = booksState[0];
      const setBooks = booksState[1];

      /* 书架 = WriterX 自己的作品库（<文档>\WriterX\作品），由 Host 侧 /inkos-panel/books 读盘。
         与 InkOS 的源书是两回事：这里是「写出来的书」，那边是「喂给引擎的设定」。 */
      const shelfState = useState([]);
      const shelf = shelfState[0];
      const setShelf = shelfState[1];
      const shelfLibState = useState("");
      const shelfLib = shelfLibState[0];
      const setShelfLib = shelfLibState[1];

      const bookIdState = useState("");
      const bookId = bookIdState[0];
      const setBookId = bookIdState[1];

      const bookState = useState(null);
      const book = bookState[0];
      const setBook = bookState[1];

      const filesState = useState([]);
      const files = filesState[0];
      const setFiles = filesState[1];

      const fileNameState = useState("");
      const fileName = fileNameState[0];
      const setFileName = fileNameState[1];

      const draftState = useState("");
      const draft = draftState[0];
      const setDraft = draftState[1];

      const origState = useState("");
      const orig = origState[0];
      const setOrig = origState[1];

      const busyState = useState("");
      const busy = busyState[0];
      const setBusy = busyState[1];

      const msgState = useState(null);
      const msg = msgState[0];
      const setMsg = msgState[1];

      const modeState = useState("native");
      const mode = modeState[0];
      const setMode = modeState[1];

      useEffect(() => {
        const on = () => setOpen(true);
        window.addEventListener(OPEN_EVENT, on);
        return () => window.removeEventListener(OPEN_EVENT, on);
      }, []);

      /** 读书架：走 Host 的 /inkos-panel/books（直接读 作品\ 目录，和书架同一个源）。 */
      async function refreshShelf() {
        setBusy("shelf");
        try {
          const res = await fetch("/inkos-panel/books", { headers: { accept: "application/json" } });
          const data = await res.json();
          if (!res.ok) throw new Error(data && data.error ? data.error : "HTTP " + res.status);
          setShelf(Array.isArray(data.books) ? data.books : []);
          setShelfLib(data.library || "");
          setMsg(null);
        } catch (error) {
          setMsg({ k: "err", s: "读书架失败：" + String((error && error.message) || error) });
        } finally {
          setBusy("");
        }
      }

      async function refreshBooks() {
        setBusy("读取书库…");
        setMsg(null);
        try {
          const r = await api("/books");
          const list = (r && r.books) || [];
          setBooks(list);
          setMsg({ t: "ok", s: "共 " + list.length + " 本" });
          if (!bookId && list.length > 0) setBookId(list[0].id);
        } catch (e) {
          setMsg({ t: "err", s: String((e && e.message) || e) });
        } finally {
          setBusy("");
        }
      }

      async function loadBook(id) {
        try {
          const r = await api("/books/" + encodeURIComponent(id));
          setBook((r && r.book) || null);
        } catch (e) {
          setBook(null);
        }
      }

      async function loadFiles(id) {
        setBusy("读取要素…");
        setMsg(null);
        setFiles([]);
        setFileName("");
        try {
          const r = await api("/books/" + encodeURIComponent(id) + "/truth");
          const list = (r && r.files) || [];
          setFiles(list);
          setMsg({ t: "ok", s: "要素 " + list.length + " 项" });
        } catch (e) {
          setMsg({ t: "err", s: String((e && e.message) || e) });
        } finally {
          setBusy("");
        }
      }

      async function loadContent(id, file) {
        setBusy("读取 " + file + "…");
        setMsg(null);
        setDraft("");
        setOrig("");
        try {
          const r = await api("/books/" + encodeURIComponent(id) + "/truth/" + encPath(file));
          const text = (r && (r.content !== undefined ? r.content : r.text)) || "";
          setDraft(text);
          setOrig(text);
          setMsg({ t: "ok", s: file + " · " + text.length + " 字符" });
        } catch (e) {
          setMsg({ t: "err", s: String((e && e.message) || e) });
        } finally {
          setBusy("");
        }
      }

      useEffect(() => {
        if (!open) return;
        const intent = window.__inkosPanelIntent;
        window.__inkosPanelIntent = "";
        if (intent === "console") {
          setMode("console");
          return;
        }
        setMode("native");
      }, [open]);

      useEffect(() => {
        if (open && books.length === 0) refreshBooks();
      }, [open, books.length]);

      useEffect(() => {
        if (!open || !bookId) return;
        loadBook(bookId);
        loadFiles(bookId);
      }, [open, bookId]);

      useEffect(() => {
        if (!open || !bookId || !fileName) return;
        loadContent(bookId, fileName);
      }, [open, bookId, fileName]);

      async function save() {
        if (!bookId || !fileName) return;
        setBusy("保存中…");
        setMsg(null);
        try {
          await api("/books/" + encodeURIComponent(bookId) + "/truth/" + encPath(fileName), {
            method: "PUT",
            body: JSON.stringify({ content: draft })
          });
          const r = await api("/books/" + encodeURIComponent(bookId) + "/truth");
          setFiles((r && r.files) || []);
          setOrig(draft);
          setMsg({ t: "ok", s: "已写入 " + fileName + "（" + draft.length + " 字符）" });
        } catch (e) {
          setMsg({ t: "err", s: String((e && e.message) || e) });
        } finally {
          setBusy("");
        }
      }

      async function writeNext() {
        if (!bookId) return;
        const meta = book || books.filter((x) => x.id === bookId)[0] || {};
        const title = meta.title || bookId;
        const before = Number(meta.chaptersWritten || 0);
        const okToGo = window.confirm(
          "让 InkOS 给《" + title + "》写下一章？\n\n" +
            "会调用书里配置的模型并真实落盘，可能需要几分钟。"
        );
        if (!okToGo) return;
        setBusy("生成中…");
        setMsg({ t: "warn", s: "已提交，等待第 " + (before + 1) + " 章" });
        try {
          await api("/books/" + encodeURIComponent(bookId) + "/write-next", {
            method: "POST",
            body: JSON.stringify({})
          });
        } catch (e) {
          setMsg({ t: "err", s: "提交失败：" + String((e && e.message) || e) });
          setBusy("");
          return;
        }
        for (let i = 0; i < 80; i++) {
          await sleep(3000);
          let nb = null;
          try {
            const r = await api("/books/" + encodeURIComponent(bookId));
            nb = (r && r.book) || null;
          } catch (e) {}
          if (nb) {
            setBook(nb);
            const now = Number(nb.chaptersWritten || 0);
            if (now > before) {
              setMsg({ t: "ok", s: "已写出第 " + now + " 章（累计 " + now + " 章）" });
              setBusy("");
              return;
            }
            setMsg({ t: "warn", s: "生成中… 已等 " + (i + 1) * 3 + " 秒，当前 " + now + " 章" });
          }
        }
        setMsg({ t: "warn", s: "等待超时（4 分钟），点「刷新」看结果" });
        setBusy("");
      }

      if (!open) return null;

      const chip = (label, color) =>
        h(
          "span",
          {
            style: {
              padding: "2px 8px",
              borderRadius: "999px",
              fontSize: "11px",
              background: color + "22",
              color: color,
              border: "1px solid " + color + "44"
            }
          },
          label
        );

      const barBtn = (label, onClick, key, accent) =>
        h(
          "button",
          {
            key: key,
            type: "button",
            onClick: onClick,
            style: {
              padding: "5px 11px",
              borderRadius: "6px",
              border: "1px solid " + (accent ? C.accent : C.line),
              background: accent ? C.accent : "transparent",
              color: accent ? "#fff" : C.text,
              cursor: "pointer",
              fontSize: "12px"
            }
          },
          label
        );

      const panelHead = h(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "9px 13px",
            background: C.bar,
            borderBottom: "1px solid " + C.line,
            flexWrap: "wrap"
          }
        },
        h("strong", { style: { color: C.text, fontSize: "13px", marginRight: "4px" } }, "写作车间"),
        h(
          "span",
          { style: { fontSize: "11px", color: C.dim } },
          book ? book.title || bookId : "未选书"
        ),
        chip(mode === "console" ? "控制台" : "原生面板", mode === "console" ? C.warn : C.accent),
        busy ? chip(busy, C.warn) : null,
        h("span", { style: { flex: 1 } }),
        mode === "native" ? barBtn("刷新", refreshBooks, "r") : null,
        mode === "native" ? barBtn("写下一章", writeNext, "w", true) : null,
        barBtn(
          mode === "native" ? "控制台" : "回面板",
          () => setMode(mode === "native" ? "console" : "native"),
          "m"
        ),
        barBtn("✕ 关闭", () => setOpen(false), "x")
      );

      const msgBar =
        msg === null
          ? null
          : h(
              "div",
              {
                style: {
                  padding: "5px 13px",
                  fontSize: "11.5px",
                  color: msg.t === "err" ? C.err : msg.t === "ok" ? C.ok : C.warn,
                  background: "rgba(255,255,255,.02)",
                  borderBottom: "1px solid " + C.line
                }
              },
              msg.s
            );

      let body;

      /* 书架页签已撤除：改由 WriterX 自带书架承接，InkOS 的书经 inkos_sync.py 同步进 作品\ */
      if (mode === "__shelf_removed__") {
        body = h(
          "div",
          { style: { flex: 1, overflowY: "auto", padding: "18px 20px" } },
          h(
            "div",
            { style: { display: "flex", alignItems: "baseline", gap: "10px", marginBottom: "14px" } },
            h("div", { style: { fontSize: "14px", fontWeight: 600, color: C.text } }, "书架"),
            h("div", { style: { fontSize: "11px", color: C.dim, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, shelfLib || "作品库"),
            h(
              "button",
              {
                type: "button",
                onClick: refreshShelf,
                style: {
                  padding: "4px 12px",
                  fontSize: "11.5px",
                  borderRadius: "6px",
                  border: "1px solid " + C.line,
                  background: "transparent",
                  color: C.text,
                  cursor: "pointer"
                }
              },
              "刷新"
            )
          ),
          shelf.length === 0
            ? h("div", { style: { fontSize: "12px", color: C.dim } }, "作品库里还没有书。")
            : h(
                "div",
                {
                  style: {
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                    gap: "12px"
                  }
                },
                shelf.map((b) =>
                  h(
                    "div",
                    {
                      key: b.dir,
                      style: {
                        border: "1px solid " + C.line,
                        borderRadius: "10px",
                        padding: "12px 13px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px",
                        minHeight: "118px"
                      }
                    },
                    h(
                      "div",
                      { style: { fontSize: "14px", fontWeight: 600, color: C.text, lineHeight: 1.3 } },
                      b.title || b.dir
                    ),
                    h(
                      "div",
                      { style: { fontSize: "11px", color: C.dim } },
                      (b.form === "short" ? "短篇" : b.form === "long" ? "长篇" : b.form || "—") +
                        " · " + b.chapters + " 章" +
                        (b.words ? " · " + (b.words >= 10000 ? (b.words / 10000).toFixed(1) + " 万字" : b.words + " 字") : "")
                    ),
                    b.dup > 0
                      ? h("div", { style: { fontSize: "10.5px", color: "#d29922" } }, "另有 " + b.dup + " 个同章历史版本")
                      : null,
                    h(
                      "div",
                      { style: { fontSize: "10.5px", color: C.dim, marginTop: "auto" } },
                      b.latestChapter ? "最新：" + b.latestChapter : "尚无正文"
                    )
                  )
                )
              )
        );
      } else if (mode === "console") {
        body = h("iframe", {
          key: "console",
          src: CONSOLE,
          title: "写作车间控制台",
          style: { flex: 1, border: 0, background: "#fff", width: "100%", height: "100%" }
        });
      } else {
        const bookCol = h(
          "div",
          {
            style: {
              width: "212px",
              minWidth: "212px",
              borderRight: "1px solid " + C.line,
              overflowY: "auto",
              padding: "6px"
            }
          },
          books.length === 0
            ? h("div", { style: { padding: "8px", fontSize: "11.5px", color: C.dim } }, "还没有书")
            : books.map((b) =>
                h(
                  "button",
                  {
                    key: b.id,
                    type: "button",
                    onClick: () => {
                      setBookId(b.id);
                      setFileName("");
                    },
                    style: {
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "7px 8px",
                      borderRadius: "6px",
                      border: "1px solid " + (b.id === bookId ? C.accent : "transparent"),
                      background: b.id === bookId ? "rgba(107,92,231,.16)" : "transparent",
                      color: C.text,
                      cursor: "pointer",
                      fontSize: "12px",
                      marginBottom: "3px"
                    }
                  },
                  h("div", { style: { fontWeight: 500, marginBottom: "2px" } }, b.title || b.id),
                  h(
                    "div",
                    { style: { fontSize: "10.5px", color: C.dim } },
                    (b.chaptersWritten || 0) + "/" + (b.targetChapters || "?") + " 章 · " + (b.genre || "—")
                  )
                )
              )
        );

        const fileCol = h(
          "div",
          {
            style: {
              width: "248px",
              minWidth: "248px",
              borderRight: "1px solid " + C.line,
              overflowY: "auto",
              padding: "6px"
            }
          },
          !bookId
            ? h("div", { style: { padding: "8px", fontSize: "11.5px", color: C.dim } }, "先选一本书")
            : files.length === 0
              ? h("div", { style: { padding: "8px", fontSize: "11.5px", color: C.dim } }, "没有要素")
              : files.map((f) =>
                  h(
                    "button",
                    {
                      key: f.name,
                      type: "button",
                      onClick: () => setFileName(f.name),
                      style: {
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        padding: "5px 7px",
                        borderRadius: "5px",
                        border: "1px solid " + (f.name === fileName ? C.accent : "transparent"),
                        background: f.name === fileName ? "rgba(107,92,231,.16)" : "transparent",
                        color: C.text,
                        cursor: "pointer",
                        fontSize: "11.5px",
                        marginBottom: "2px"
                      }
                    },
                    h(
                      "div",
                      { style: { display: "flex", alignItems: "center", gap: "5px" } },
                      h("span", { style: { flex: 1, wordBreak: "break-all" } }, f.name),
                      f.legacy ? chip("legacy", C.warn) : null
                    ),
                    h("div", { style: { fontSize: "10px", color: C.dim } }, (f.size || 0) + " 字节")
                  )
                )
        );

        const dirty = draft !== orig;
        const editorCol = h(
          "div",
          { style: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0, background: C.bg } },
          fileName
            ? h(
                "div",
                {
                  style: {
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "5px 10px",
                    borderBottom: "1px solid " + C.line,
                    fontSize: "11.5px",
                    color: C.dim,
                    flexWrap: "wrap"
                  }
                },
                h("span", { style: { color: C.text, wordBreak: "break-all" } }, fileName),
                h("span", null, draft.length + " 字符"),
                dirty ? chip("未保存", C.warn) : chip("已同步", C.ok),
                h("span", { style: { flex: 1 } }),
                barBtn("保存", save, "s", dirty),
                barBtn(
                  "还原",
                  () => setDraft(orig),
                  "rv"
                )
              )
            : null,
          fileName
            ? h("textarea", {
                value: draft,
                onChange: (ev) => setDraft(ev.target.value),
                spellCheck: false,
                style: {
                  flex: 1,
                  width: "100%",
                  border: 0,
                  outline: "none",
                  resize: "none",
                  padding: "12px 14px",
                  background: C.bg,
                  color: C.text,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                  fontSize: "12.5px",
                  lineHeight: 1.65
                }
              })
            : h(
                "div",
                {
                  style: {
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: C.dim,
                    fontSize: "12px",
                    flexDirection: "column",
                    gap: "8px"
                  }
                },
                h("div", { style: { fontSize: "26px", opacity: 0.4 } }, "🧩"),
                h("div", null, "左边选书 → 中间选要素 → 这里编辑并保存")
              )
        );

        body = h("div", { style: { flex: 1, display: "flex", minHeight: 0 } }, bookCol, fileCol, editorCol);
      }

      return h(
        "div",
        {
          style: {
            position: "fixed",
            inset: 0,
            zIndex: 2147483000,
            background: "rgba(0,0,0,.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center"
          },
          onClick: (e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }
        },
        h(
          "div",
          {
            style: {
              width: "min(1560px, 95vw)",
              height: "88vh",
              background: C.bg,
              borderRadius: "12px",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              boxShadow: "0 24px 60px rgba(0,0,0,.6)",
              border: "1px solid " + C.line
            }
          },
          panelHead,
          msgBar,
          body
        )
      );
    }

    function apply(ctx) {
      ctx.effect(
        () =>
          ctx.slots.inject("sidebar.header.action", () =>
            ctx.slots.register(
              {
                name: "sidebar.header.action",
                id: "local-inkos",
                order: 25,
                inject: () => ({})
              },
              InkOSEntry
            )
          ),
        "inkos-panel: sidebar group"
      );

      ctx.effect(
        () =>
          ctx.slots.inject("shell.overlay", () =>
            ctx.slots.register(
              {
                name: "shell.overlay",
                id: "local-inkos",
                order: 25,
                inject: () => ({})
              },
              InkOSOverlay
            )
          ),
        "inkos-panel: overlay"
      );
    }

    exports.name = name;
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  }
});
