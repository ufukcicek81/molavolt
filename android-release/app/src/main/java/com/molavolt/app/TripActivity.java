package com.molavolt.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;

/**
 * Opened from the web app's "Yola çık" with molavolt://trip?d=<trip json>. Starts {@link TripService}, which follows
 * the drive in the background and sends the charging-stop notifications, then opens the navigation link
 * (Google Maps) carried in the trip data.
 */
public class TripActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Uri data = getIntent() != null ? getIntent().getData() : null;
        String trip = data != null ? data.getQueryParameter("d") : null;
        String maps = null;
        if (trip != null) {
            try {
                maps = new org.json.JSONObject(trip).optString("maps", null);
                Intent service = new Intent(this, TripService.class)
                        .setAction(TripService.ACTION_START)
                        .putExtra(TripService.EXTRA_TRIP, trip);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(service);
                else startService(service);
            } catch (Exception ignored) {
                // a broken trip must not block navigation
            }
        }
        if (maps != null && !maps.isEmpty()) {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(maps)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            } catch (Exception ignored) {
            }
        }
        finish();
    }
}
