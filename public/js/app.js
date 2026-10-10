/* Gather uses a local copy of jQuery. No CDN or runtime third-party requests. */
window.Gather = {
    locale: document.documentElement.lang || "en",
    t(key, values = {}) {
        let value = window.TRANSLATIONS?.[this.locale]?.[key] || key;
        for (const [name, replacement] of Object.entries(values))
            value = value.replaceAll(":" + name, replacement);
        return value;
    },
    toast(message) {
        $("#toast").text(message).addClass("show");
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(
            () => $("#toast").removeClass("show"),
            4000,
        );
    },
    async copy(text) {
        try {
            await navigator.clipboard.writeText(text);
            this.toast(Gather.t("Invitation link copied."));
        } catch {
            const input = $("<textarea>").val(text).appendTo("body").select();
            const copied = document.execCommand("copy");
            input.remove();
            this.toast(
                copied
                    ? Gather.t("Invitation link copied.")
                    : Gather.t("Copy this link: ") + text,
            );
        }
    },
    error(xhr) {
        return (
            xhr.responseJSON?.message ||
            Gather.t("Something went wrong. Please try again.")
        );
    },
    api(url, method = "GET", data = {}) {
        return $.ajax({
            url,
            method,
            data: method === "GET" ? data : JSON.stringify(data),
            contentType: "application/json",
            dataType: method === "GET" ? "json" : undefined,
            headers: {
                "X-CSRF-TOKEN": $('meta[name="csrf-token"]').attr("content"),
                Accept: "application/json",
            },
            timeout: 12000,
        });
    },
};
$(function () {
    $("#language-select").on("change", async function () {
        const locale = this.value,
            previous = Gather.locale;
        $(this).prop("disabled", true);
        try {
            await Gather.api("/language/" + locale, "POST", {});
            if (!window.ROOM) {
                location.reload();
                return;
            }
            const old = window.TRANSLATIONS[previous],
                next = window.TRANSLATIONS[locale];
            const lookup = new Map(
                Object.entries(old).map(([key, value]) => [value.trim(), key]),
            );
            function translate(value) {
                const key = lookup.get(value.trim());
                return key
                    ? value.replace(value.trim(), next[key].trim())
                    : value;
            }
            const walker = document.createTreeWalker(
                document.body,
                NodeFilter.SHOW_TEXT,
            );
            const nodes = [];
            while (walker.nextNode()) nodes.push(walker.currentNode);
            for (const node of nodes) {
                if (
                    node.parentElement.closest(
                        "script,style,.messages,.tile-name,.person-details,.room-title h1,.floating-reaction,.language-switch",
                    )
                )
                    continue;
                node.nodeValue = translate(node.nodeValue);
            }
            document
                .querySelectorAll(
                    "[aria-label],[title],[placeholder],[data-confirm]",
                )
                .forEach((element) => {
                    for (const attribute of [
                        "aria-label",
                        "title",
                        "placeholder",
                        "data-confirm",
                    ])
                        if (element.hasAttribute(attribute))
                            element.setAttribute(
                                attribute,
                                translate(element.getAttribute(attribute)),
                            );
                });
            Gather.locale = locale;
            document.documentElement.lang = locale;
            document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
            document.dispatchEvent(new Event("gather:language"));
        } catch {
            this.value = previous;
            Gather.toast(
                Gather.t("Unable to change language. Please try again."),
            );
        } finally {
            $(this).prop("disabled", false);
        }
    });
    $("[data-dialog]").on("click", function () {
        document.getElementById($(this).data("dialog")).showModal();
    });
    $("[data-close-dialog]").on("click", function () {
        $(this).closest("dialog")[0].close();
    });
    $("dialog").on("click", function (event) {
        if (
            event.target === this &&
            (event.offsetX < 0 ||
                event.offsetX > this.offsetWidth ||
                event.offsetY < 0 ||
                event.offsetY > this.offsetHeight)
        )
            this.close();
    });
    $("[data-copy]").on("click", function () {
        Gather.copy($(this).data("copy"));
    });
    $("[data-confirm]").on("submit", function (event) {
        if (!confirm($(this).data("confirm"))) event.preventDefault();
    });
    $("#today-date").text(
        new Intl.DateTimeFormat(Gather.locale, {
            weekday: "long",
            month: "short",
            day: "numeric",
        }).format(new Date()),
    );
    $("[data-local-date]").each(function () {
        $(this).text(
            new Intl.DateTimeFormat(Gather.locale, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
            }).format(new Date($(this).data("local-date"))),
        );
    });
    $("#timezone-label").text(
        Gather.t("Times are in ") +
            Intl.DateTimeFormat().resolvedOptions().timeZone +
            Gather.t(
                ". Duration is for planning; rooms do not end automatically.",
            ),
    );
    $("#schedule-form").on("submit", function () {
        $("#scheduled-at").val(
            new Date($("#scheduled-local").val()).toISOString(),
        );
    });
    const later = new Date(Date.now() + 3600000);
    later.setMinutes(0, 0, 0);
    const localDate = new Date(
        later.getTime() - later.getTimezoneOffset() * 60000,
    )
        .toISOString()
        .slice(0, 16);
    $("#scheduled-local").val(localDate);
    $("#meeting-search").on("input", function () {
        const query = this.value.toLowerCase().trim();
        let count = 0;
        $(".meeting-card").each(function () {
            const show = $(this).data("search").includes(query);
            $(this).prop("hidden", !show);
            count += show;
        });
        $("#no-search-results").prop("hidden", !!count || !query);
    });
});
