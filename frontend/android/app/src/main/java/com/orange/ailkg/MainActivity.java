package com.orange.ailkg;

import android.os.Bundle;

import com.chaquo.python.Python;
import com.chaquo.python.android.AndroidPlatform;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int BACKEND_PORT = 43126;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        if (!Python.isStarted()) {
            Python.start(new AndroidPlatform(this));
        }
        Python.getInstance()
            .getModule("android_server")
            .callAttr("start", getFilesDir().getAbsolutePath(), BACKEND_PORT);
        super.onCreate(savedInstanceState);
    }
}
