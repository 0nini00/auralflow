package cn.chenle.auralflow.mobile;

import android.app.Service;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.ResultReceiver;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;

public class LyricOverlayService extends Service {
    public static final String ACTION_SHOW = "cn.chenle.auralflow.mobile.lyrics.SHOW";
    public static final String ACTION_UPDATE = "cn.chenle.auralflow.mobile.lyrics.UPDATE";
    public static final String ACTION_SET_LOCKED = "cn.chenle.auralflow.mobile.lyrics.SET_LOCKED";
    public static final String ACTION_HIDE = "cn.chenle.auralflow.mobile.lyrics.HIDE";
    public static final String ACTION_APPLY_STYLE = "cn.chenle.auralflow.mobile.lyrics.APPLY_STYLE";
    public static final String EXTRA_CURRENT = "current";
    public static final String EXTRA_NEXT = "next";
    public static final String EXTRA_LOCKED = "locked";
    public static final String EXTRA_FROM_NOTIFICATION = "fromNotification";
    public static final String EXTRA_RESULT_RECEIVER = "resultReceiver";
    public static final int RESULT_SUCCESS = 1;
    public static final int RESULT_FAILURE = 2;
    public static final String RESULT_ERROR_CODE = "errorCode";
    public static final String RESULT_ERROR_MESSAGE = "errorMessage";

    private static final String ERROR_PERMISSION_REVOKED = "E_OVERLAY_PERMISSION_REVOKED";
    private static final String ERROR_WINDOW_SHOW = "E_OVERLAY_WINDOW_SHOW";
    private static final String ERROR_WINDOW_UPDATE = "E_OVERLAY_WINDOW_UPDATE";
    private static final String ERROR_WINDOW_LOCK = "E_OVERLAY_WINDOW_LOCK";
    private static final String ERROR_WINDOW_HIDE = "E_OVERLAY_WINDOW_HIDE";
    private static final String ERROR_UNKNOWN_ACTION = "E_OVERLAY_UNKNOWN_ACTION";
    private static final String TAG = "LyricOverlayService";

    private static final int BASE_WINDOW_FLAGS =
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
            | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN;

    private WindowManager windowManager;
    private WindowManager.LayoutParams layoutParams;
    private LinearLayout overlayView;
    private TextView currentLyricView;
    private TextView nextLyricView;
    private boolean windowAttached;

    private String currentText = "";
    private String nextText = "";
    private boolean locked;

    private int dragStartX;
    private int dragStartY;
    private float dragTouchX;
    private float dragTouchY;

    @Override
    public void onCreate() {
        super.onCreate();
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            return START_NOT_STICKY;
        }
        executeOperation(intent, startId, getResultReceiver(intent));
        return START_NOT_STICKY;
    }

    private void executeOperation(Intent intent, int startId, ResultReceiver receiver) {
        String action = intent.getAction();
        boolean fromNotification = intent.getBooleanExtra(EXTRA_FROM_NOTIFICATION, false);
        if (receiver == null && !fromNotification) {
            Log.e(TAG, "Missing result receiver for action: " + action);
            return;
        }

        if (
            ACTION_UPDATE.equals(action)
                && (!LyricOverlayPreferences.isVisible(this) || !Settings.canDrawOverlays(this))
        ) {
            return;
        }

        if (requiresOverlayPermission(action) && !Settings.canDrawOverlays(this)) {
            LyricOverlayPreferences.setVisible(this, false);
            LyricOverlayPreferences.notifyNotificationStateChanged(this);
            if (receiver != null) {
                sendFailure(
                    receiver,
                    ERROR_PERMISSION_REVOKED,
                    "悬浮窗权限已被撤销，操作未执行"
                );
            }
            return;
        }

        try {
            if (ACTION_SHOW.equals(action)) {
                ensureWindow();
                LyricOverlayPreferences.setVisible(this, true);
                LyricOverlayPreferences.notifyNotificationStateChanged(this);
                if (receiver != null) sendSuccess(receiver);
                return;
            }
            if (ACTION_UPDATE.equals(action)) {
                currentText = intent.getStringExtra(EXTRA_CURRENT);
                nextText = intent.getStringExtra(EXTRA_NEXT);
                ensureWindow();
                renderState();
                if (receiver != null) sendSuccess(receiver);
                return;
            }
            if (ACTION_SET_LOCKED.equals(action)) {
                if (!windowAttached) {
                    throw new IllegalStateException("悬浮歌词窗口尚未创建");
                }
                locked = intent.getBooleanExtra(EXTRA_LOCKED, false);
                applyLockedState();
                if (receiver != null) sendSuccess(receiver);
                return;
            }
            if (ACTION_APPLY_STYLE.equals(action)) {
                // 样式已由 Module 写入 Preferences，这里只负责就地重刷已挂载的窗口。
                // 窗口未挂载时无需处理：下次 ensureWindow 会直接读到新值。
                applyStyle();
                if (receiver != null) sendSuccess(receiver);
                return;
            }
            if (ACTION_HIDE.equals(action)) {
                LyricOverlayPreferences.setVisible(this, false);
                LyricOverlayPreferences.notifyNotificationStateChanged(this);
                removeOverlayWindow();
                if (receiver != null) sendSuccess(receiver);
                stopSelf(startId);
                return;
            }
            if (receiver != null) sendFailure(receiver, ERROR_UNKNOWN_ACTION, "未知的悬浮歌词操作");
        } catch (SecurityException error) {
            handleOperationFailure(receiver, action, error);
        } catch (RuntimeException error) {
            handleOperationFailure(receiver, action, error);
        }
    }

    private void handleOperationFailure(ResultReceiver receiver, String action, RuntimeException error) {
        if (ACTION_SHOW.equals(action)) {
            LyricOverlayPreferences.setVisible(this, false);
            LyricOverlayPreferences.notifyNotificationStateChanged(this);
        }
        Log.e(TAG, "Lyric overlay operation failed: " + action, error);
        if (receiver != null) {
            sendFailure(receiver, errorCodeForAction(action), errorMessage(error));
        }
    }

    private boolean requiresOverlayPermission(String action) {
        return ACTION_SHOW.equals(action)
            || ACTION_UPDATE.equals(action)
            || ACTION_SET_LOCKED.equals(action);
    }

    private String errorCodeForAction(String action) {
        if (ACTION_SHOW.equals(action)) return ERROR_WINDOW_SHOW;
        if (ACTION_UPDATE.equals(action)) return ERROR_WINDOW_UPDATE;
        if (ACTION_SET_LOCKED.equals(action)) return ERROR_WINDOW_LOCK;
        if (ACTION_HIDE.equals(action)) return ERROR_WINDOW_HIDE;
        if (ACTION_APPLY_STYLE.equals(action)) return ERROR_WINDOW_UPDATE;
        return ERROR_UNKNOWN_ACTION;
    }

    private String errorMessage(RuntimeException error) {
        String message = error.getMessage();
        return message == null || message.isEmpty() ? error.getClass().getSimpleName() : message;
    }

    @SuppressWarnings("deprecation")
    private ResultReceiver getResultReceiver(Intent intent) {
        return intent.getParcelableExtra(EXTRA_RESULT_RECEIVER);
    }

    private void sendSuccess(ResultReceiver receiver) {
        receiver.send(RESULT_SUCCESS, Bundle.EMPTY);
    }

    private void sendFailure(ResultReceiver receiver, String code, String message) {
        Bundle result = new Bundle();
        result.putString(RESULT_ERROR_CODE, code);
        result.putString(RESULT_ERROR_MESSAGE, message);
        receiver.send(RESULT_FAILURE, result);
    }

    private void ensureWindow() {
        if (windowAttached) {
            return;
        }

        overlayView = new LinearLayout(this);
        overlayView.setOrientation(LinearLayout.VERTICAL);
        overlayView.setPadding(dp(16), dp(10), dp(16), dp(10));

        // 不再画背景块与进度条：85% 不透明的深色底几乎盖住整片壁纸，
        // 系统默认样式的进度条也与桌面观感格格不入。改为纯文字 + 投影，
        // 靠投影保证在任意壁纸上的可读性（对齐 lx 桌面歌词的做法）。
        currentLyricView = createLyricText(fontSizeSp(), 0xFFFFFFFF);
        nextLyricView = createLyricText(nextFontSizeSp(), 0xB3FFFFFF);
        LinearLayout.LayoutParams nextTextParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        nextTextParams.topMargin = dp(2);

        overlayView.addView(currentLyricView);
        overlayView.addView(nextLyricView, nextTextParams);
        overlayView.setOnTouchListener(this::handleDrag);

        layoutParams = new WindowManager.LayoutParams(
            dp(320),
            WindowManager.LayoutParams.WRAP_CONTENT,
            windowType(),
            windowFlags(),
            PixelFormat.TRANSLUCENT
        );
        layoutParams.gravity = Gravity.TOP | Gravity.START;
        layoutParams.x = dp(20);
        layoutParams.y = dp(100);

        windowManager.addView(overlayView, layoutParams);
        windowAttached = true;
    }

    private float fontSizeSp() {
        return LyricOverlayPreferences.getFontSize(this);
    }

    /** 下一行比当前行小一档，最低不小于 11sp，避免大字号时两行差距过小。 */
    private float nextFontSizeSp() {
        return Math.max(11f, fontSizeSp() - 4f);
    }

    /** 把配置的不透明度（10-100）折算进颜色的 alpha 通道。 */
    private int applyOpacity(int color) {
        int opacity = LyricOverlayPreferences.getTextOpacity(this);
        int baseAlpha = (color >>> 24) & 0xFF;
        int alpha = Math.round(baseAlpha * (opacity / 100f));
        return (alpha << 24) | (color & 0x00FFFFFF);
    }

    private int windowType() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            : WindowManager.LayoutParams.TYPE_SYSTEM_ALERT;
    }

    private TextView createLyricText(float sizeSp, int color) {
        TextView view = new TextView(this);
        view.setTextSize(sizeSp);
        view.setTextColor(applyOpacity(color));
        view.setMaxLines(1);
        view.setEllipsize(android.text.TextUtils.TruncateAt.END);
        view.setGravity(Gravity.CENTER);
        applyShadow(view);
        return view;
    }

    /**
     * 文字投影：去掉背景块后，这是浅色壁纸下唯一的可读性保障。
     * 半径取字号的 1/5，向下偏移 1dp，接近系统桌面小组件的观感。
     */
    private void applyShadow(TextView view) {
        if (LyricOverlayPreferences.isShadowEnabled(this)) {
            view.setShadowLayer(Math.max(3f, view.getTextSize() / 5f), 0f, dp(1), 0xCC000000);
        } else {
            view.setShadowLayer(0f, 0f, 0f, Color.TRANSPARENT);
        }
    }

    /** 样式变更后就地重刷：避免销毁重建窗口导致位置与锁定态丢失。 */
    private void applyStyle() {
        if (!windowAttached) {
            return;
        }
        currentLyricView.setTextSize(fontSizeSp());
        currentLyricView.setTextColor(applyOpacity(0xFFFFFFFF));
        applyShadow(currentLyricView);

        nextLyricView.setTextSize(nextFontSizeSp());
        nextLyricView.setTextColor(applyOpacity(0xB3FFFFFF));
        applyShadow(nextLyricView);
        nextLyricView.setVisibility(
            LyricOverlayPreferences.isShowNextLine(this) ? View.VISIBLE : View.GONE
        );
    }

    private void renderState() {
        if (!windowAttached) {
            return;
        }
        currentLyricView.setText(currentText == null ? "" : currentText);
        nextLyricView.setText(nextText == null ? "" : nextText);
        nextLyricView.setVisibility(
            LyricOverlayPreferences.isShowNextLine(this) ? View.VISIBLE : View.GONE
        );
        applyLockedState();
    }

    private void applyLockedState() {
        if (!windowAttached) {
            return;
        }
        int nextFlags = windowFlags();
        if (layoutParams.flags == nextFlags) {
            return;
        }
        layoutParams.flags = nextFlags;
        windowManager.updateViewLayout(overlayView, layoutParams);
    }

    private int windowFlags() {
        return locked
            ? BASE_WINDOW_FLAGS | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
            : BASE_WINDOW_FLAGS;
    }

    private boolean handleDrag(View view, MotionEvent event) {
        if (locked) {
            return false;
        }

        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                dragStartX = layoutParams.x;
                dragStartY = layoutParams.y;
                dragTouchX = event.getRawX();
                dragTouchY = event.getRawY();
                return true;
            case MotionEvent.ACTION_MOVE:
                layoutParams.x = dragStartX + Math.round(event.getRawX() - dragTouchX);
                layoutParams.y = dragStartY + Math.round(event.getRawY() - dragTouchY);
                clampWindowPosition(view);
                windowManager.updateViewLayout(overlayView, layoutParams);
                return true;
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL:
                return true;
            default:
                return false;
        }
    }

    private void clampWindowPosition(View view) {
        DisplayMetrics metrics = getResources().getDisplayMetrics();
        int screenWidth = metrics.widthPixels;
        int screenHeight = metrics.heightPixels;
        int windowWidth = layoutParams.width > 0 ? layoutParams.width : view.getWidth();
        int windowHeight = view.getHeight() > 0 ? view.getHeight() : 0;
        int maxX = Math.max(0, screenWidth - windowWidth);
        int maxY = Math.max(0, screenHeight - windowHeight);
        layoutParams.x = Math.max(0, Math.min(maxX, layoutParams.x));
        layoutParams.y = Math.max(0, Math.min(maxY, layoutParams.y));
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void removeOverlayWindow() {
        if (!windowAttached) {
            return;
        }
        windowManager.removeView(overlayView);
        windowAttached = false;
        overlayView = null;
        currentLyricView = null;
        nextLyricView = null;
        layoutParams = null;
    }

    @Override
    public void onDestroy() {
        LyricOverlayPreferences.setVisible(this, false);
        LyricOverlayPreferences.notifyNotificationStateChanged(this);
        if (windowAttached) {
            try {
                removeOverlayWindow();
            } catch (RuntimeException error) {
                Log.e(TAG, "Unexpected overlay removal failure during service destroy", error);
            }
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
