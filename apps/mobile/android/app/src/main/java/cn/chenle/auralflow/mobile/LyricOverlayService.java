package cn.chenle.auralflow.mobile;

import android.app.Service;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.ResultReceiver;
import android.provider.Settings;
import android.util.Log;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

public class LyricOverlayService extends Service {
    public static final String ACTION_SHOW = "cn.chenle.auralflow.mobile.lyrics.SHOW";
    public static final String ACTION_UPDATE = "cn.chenle.auralflow.mobile.lyrics.UPDATE";
    public static final String ACTION_SET_LOCKED = "cn.chenle.auralflow.mobile.lyrics.SET_LOCKED";
    public static final String ACTION_HIDE = "cn.chenle.auralflow.mobile.lyrics.HIDE";
    public static final String EXTRA_CURRENT = "current";
    public static final String EXTRA_NEXT = "next";
    public static final String EXTRA_PROGRESS = "progress";
    public static final String EXTRA_LOCKED = "locked";
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

    private static final int PROGRESS_MAX = 1000;
    private static final int BASE_WINDOW_FLAGS =
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
            | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN;

    private WindowManager windowManager;
    private WindowManager.LayoutParams layoutParams;
    private LinearLayout overlayView;
    private TextView currentLyricView;
    private TextView nextLyricView;
    private ProgressBar progressView;
    private boolean windowAttached;

    private String currentText = "";
    private String nextText = "";
    private float progress;
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
        if (receiver == null) {
            Log.e(TAG, "Missing result receiver for action: " + action);
            return;
        }

        if (requiresOverlayPermission(action) && !Settings.canDrawOverlays(this)) {
            sendFailure(
                receiver,
                ERROR_PERMISSION_REVOKED,
                "悬浮窗权限已被撤销，操作未执行"
            );
            return;
        }

        try {
            if (ACTION_SHOW.equals(action)) {
                ensureWindow();
                sendSuccess(receiver);
                return;
            }
            if (ACTION_UPDATE.equals(action)) {
                currentText = intent.getStringExtra(EXTRA_CURRENT);
                nextText = intent.getStringExtra(EXTRA_NEXT);
                progress = clampProgress(intent.getFloatExtra(EXTRA_PROGRESS, 0f));
                ensureWindow();
                renderState();
                sendSuccess(receiver);
                return;
            }
            if (ACTION_SET_LOCKED.equals(action)) {
                if (!windowAttached) {
                    throw new IllegalStateException("悬浮歌词窗口尚未创建");
                }
                locked = intent.getBooleanExtra(EXTRA_LOCKED, false);
                applyLockedState();
                sendSuccess(receiver);
                return;
            }
            if (ACTION_HIDE.equals(action)) {
                removeOverlayWindow();
                sendSuccess(receiver);
                stopSelf(startId);
                return;
            }
            sendFailure(receiver, ERROR_UNKNOWN_ACTION, "未知的悬浮歌词操作");
        } catch (SecurityException error) {
            sendFailure(receiver, errorCodeForAction(action), errorMessage(error));
        } catch (RuntimeException error) {
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
        overlayView.setPadding(dp(16), dp(12), dp(16), dp(10));

        GradientDrawable background = new GradientDrawable();
        background.setColor(0xD91A1A1A);
        background.setCornerRadius(dp(12));
        overlayView.setBackground(background);

        currentLyricView = createLyricText(16f, Color.WHITE);
        nextLyricView = createLyricText(13f, 0xB3FFFFFF);
        LinearLayout.LayoutParams nextTextParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        nextTextParams.topMargin = dp(4);

        progressView = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressView.setMax(PROGRESS_MAX);
        LinearLayout.LayoutParams progressParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            dp(3)
        );
        progressParams.topMargin = dp(8);

        overlayView.addView(currentLyricView);
        overlayView.addView(nextLyricView, nextTextParams);
        overlayView.addView(progressView, progressParams);
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

    private int windowType() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            : WindowManager.LayoutParams.TYPE_SYSTEM_ALERT;
    }

    private TextView createLyricText(float sizeSp, int color) {
        TextView view = new TextView(this);
        view.setTextSize(sizeSp);
        view.setTextColor(color);
        view.setMaxLines(1);
        view.setGravity(Gravity.CENTER);
        return view;
    }

    private void renderState() {
        if (!windowAttached) {
            return;
        }
        currentLyricView.setText(currentText == null ? "" : currentText);
        nextLyricView.setText(nextText == null ? "" : nextText);
        progressView.setProgress(Math.round(progress * PROGRESS_MAX));
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
                windowManager.updateViewLayout(overlayView, layoutParams);
                return true;
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL:
                return true;
            default:
                return false;
        }
    }

    private float clampProgress(float value) {
        if (!Float.isFinite(value)) {
            return 0f;
        }
        return Math.max(0f, Math.min(1f, value));
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
        progressView = null;
        layoutParams = null;
    }

    @Override
    public void onDestroy() {
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
