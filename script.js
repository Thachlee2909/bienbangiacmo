(() => {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const REFRESH_MS = 30000;
    let records = [];
    let currentUser = null;
    let toastTimeout;
    let refreshing = false;

    const toast = (message) => {
        const node = $('toast');
        node.textContent = message;
        node.style.display = 'block';
        clearTimeout(toastTimeout);
        toastTimeout = setTimeout(() => {
            node.style.display = 'none';
        }, 3000);
    };

    const el = (tag, className, content) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (content !== undefined) node.textContent = content;
        return node;
    };

    const fmt = (value) => new Date(value).toLocaleString('vi-VN', {
        dateStyle: 'short',
        timeStyle: 'short'
    });

    const left = (expiresAt) => {
        const ms = Math.max(0, new Date(expiresAt).getTime() - Date.now());
        const hours = Math.floor(ms / 3600000);
        const minutes = Math.floor((ms % 3600000) / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        return `${hours}g ${String(minutes).padStart(2, '0')}p ${String(seconds).padStart(2, '0')}s`;
    };

    const localDateTime = () => {
        const d = new Date();
        const pad = (number) => String(number).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    function setPage(page) {
        document.body.dataset.view = page;
        document.querySelectorAll('[data-page]').forEach((button) => {
            button.classList.toggle('active', button.dataset.page === page);
        });
        if (page === 'settings') $('settings').classList.remove('hidden');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function render() {
        const now = Date.now();
        records = records.filter((record) => new Date(record.expires_at).getTime() > now);
        $('counter').textContent = `${records.length} biên bản • Tự xóa sau 24 giờ`;
        $('entries').replaceChildren();

        if (!records.length) {
            $('entries').append(el('div', 'empty', '💤 Chưa có biên bản nào. Đêm nay sẽ có chuyện gì nhỉ?'));
            return;
        }

        for (const record of records) {
            const box = el('article', 'entry');
            const top = el('div', 'entrytop');
            const info = el('div');
            const title = el('h3', '', `🍮 ${record.sleeper_name} đang nói mớ`);
            info.append(title, el('div', 'meta', `👀 ${record.witness_name} chứng kiến • ${fmt(record.occurred_at)} • Lưu ${fmt(record.created_at)}`));

            const timer = el('div', 'timer', `⏳ ${left(record.expires_at)}`);
            timer.dataset.expiresAt = record.expires_at;
            top.append(info, timer);
            box.append(top);

            if (record.quote) box.append(el('div', 'quote', `“${record.quote}”`));
            box.append(el('p', '', ` Đã nói: ${record.speech}`));
            if (record.actions) box.append(el('p', '', ` Đã làm: ${record.actions}`));
            box.append(el('span', 'tag', `Mức độ kỳ lạ: ${'⭐'.repeat(record.weirdness)}`));

            const controls = el('div', 'actions');
            const copy = el('button', 'smallbtn', ' Sao chép');
            copy.type = 'button';
            copy.onclick = async () => {
                const content = [
                    'BIÊN BẢN GIẤC MƠ',
                    `Người ngủ: ${record.sleeper_name}`,
                    `Người chứng kiến: ${record.witness_name}`,
                    `Thời điểm: ${fmt(record.occurred_at)}`,
                    `Đã nói: ${record.speech}`,
                    `Đã làm: ${record.actions || 'Không ghi nhận'}`,
                    `Câu nói đáng nhớ: ${record.quote || 'Không có'}`,
                    `Mức độ kỳ lạ: ${record.weirdness}/5`
                ].join('\n');
                try {
                    await navigator.clipboard.writeText(content);
                    toast('Đã sao chép biên bản!');
                } catch {
                    toast('Không thể sao chép trên trình duyệt này.');
                }
            };
            controls.append(copy);
            box.append(controls);
            $('entries').append(box);
        }
    }

    async function ensureAnonymousSession() {
        const { data, error } = await db.auth.getSession();
        if (error) throw error;
        if (data.session?.user) return data.session.user;

        const result = await db.auth.signInAnonymously();
        if (result.error) throw result.error;
        return result.data.user;
    }

    async function loadReports({ silent = false } = {}) {
        if (refreshing) return;
        refreshing = true;
        try {
            const { data, error } = await db
                .from('dream_reports')
                .select('id, sleeper_name, witness_name, occurred_at, speech, actions, quote, weirdness, created_at, expires_at')
                .gt('expires_at', new Date().toISOString())
                .order('created_at', { ascending: false })
                .limit(100);
            if (error) throw error;
            records = data ?? [];
            render();
        } catch (error) {
            console.error('Lỗi tải biên bản:', error);
            if (!silent) toast('Không tải được biên bản. Vui lòng thử lại.');
        } finally {
            refreshing = false;
        }
    }

    async function saveReport(event) {
        event.preventDefault();
        const occurred = new Date($('occurred').value);
        if (!Number.isFinite(occurred.getTime()) || occurred.getTime() > Date.now()) {
            toast('Thời gian xảy ra không được ở tương lai.');
            return;
        }

        const report = {
            sleeper_name: $('sleeper').value.trim(),
            witness_name: $('witness').value.trim(),
            occurred_at: occurred.toISOString(),
            speech: $('speech').value.trim(),
            actions: $('actions').value.trim(),
            quote: $('quote').value.trim(),
            weirdness: Number($('weirdness').value)
        };

        if (!report.sleeper_name || !report.witness_name || !report.speech) {
            toast('Vui lòng nhập đủ các trường bắt buộc.');
            return;
        }

        const saveButton = $('saveButton') || $('dreamForm').querySelector('[type="submit"]');
        saveButton.disabled = true;
        try {
            const { error } = await db.from('dream_reports').insert(report);
            if (error) throw error;
            event.target.reset();
            $('occurred').value = localDateTime();
            await loadReports();
            toast('Đã lưu! Biên bản sẽ hết hạn sau 24 giờ.');
            setPage('today');
        } catch (error) {
            console.error('Lỗi lưu biên bản:', error);
            toast('Không lưu được biên bản. Vui lòng thử lại.');
        } finally {
            saveButton.disabled = false;
        }
    }

    function updateTimers() {
        const active = records.filter((record) => new Date(record.expires_at).getTime() > Date.now());
        if (active.length !== records.length) {
            records = active;
            render();
            return;
        }
        document.querySelectorAll('.timer[data-expires-at]').forEach((node) => {
            node.textContent = ` ${left(node.dataset.expiresAt)}`;
        });
    }

    async function init() {
        $('occurred').value = localDateTime();
        document.querySelectorAll('[data-page]').forEach((button) => {
            button.onclick = () => setPage(button.dataset.page);
        });
        $('dreamForm').addEventListener('submit', saveReport);

        // RLS không cấp quyền DELETE: vô hiệu hóa nút cũ, tránh gây hiểu nhầm.
        const clearAll = $('clearAll');
        if (clearAll) {
            clearAll.disabled = true;
            clearAll.title = 'Biên bản tự xóa sau 24 giờ; không hỗ trợ xóa thủ công.';
        }
        const settingsText = $('settings')?.querySelector('p');
        if (settingsText) {
            settingsText.textContent = 'Biên bản được lưu trên Supabase và có thể xem công khai từ nhiều thiết bị. Biên bản tự hết hạn sau 24 giờ kể từ lúc lưu và được hệ thống xóa định kỳ. Không nhập thông tin nhạy cảm.';
        }

        const saveButton = $('saveButton') || $('dreamForm').querySelector('[type="submit"]');
        saveButton.disabled = true;
        const status = $('statusMessage');
        if (status) status.textContent = 'Đang kết nối Supabase...';

        try {
            if (typeof db === 'undefined') throw new Error('Thiếu supabase-config.js');
            currentUser = await ensureAnonymousSession();
            await loadReports();
            saveButton.disabled = false;
            if (status) status.textContent = '';
        } catch (error) {
            console.error('Lỗi khởi tạo:', error);
            if (status) status.textContent = 'Không kết nối được Supabase. Hãy kiểm tra cấu hình và Anonymous Sign-ins.';
            toast('Không kết nối được Supabase.');
            return;
        }

        setInterval(updateTimers, 1000);
        setInterval(() => loadReports({ silent: true }), REFRESH_MS);
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) loadReports({ silent: true });
        });
    }

    init();
})();
