package com.molavolt.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Follows a planned trip while the driver navigates in another app, and tells them through notifications:
 * on reaching a planned charging stop, on leaving it ("how far did you charge?"), and every 90 minutes ("what is
 * your battery level?"). Tapping a notification opens MolaVolt on that question. Runs as a location foreground
 * service with an ongoing notification and a stop button; it ends at the destination or after 20 hours.
 */
public class TripService extends Service {
    static final String ACTION_START = "com.molavolt.app.TRIP_START";
    static final String ACTION_STOP = "com.molavolt.app.TRIP_STOP";
    static final String EXTRA_TRIP = "trip";
    private static final String CHANNEL_ONGOING = "trip_ongoing";
    private static final String CHANNEL_ALERTS = "trip_alerts";
    private static final int ID_ONGOING = 1;
    private static final long SOC_EVERY_MS = 90L * 60 * 1000;
    private static final long MAX_TRIP_MS = 20L * 60 * 60 * 1000;

    private FusedLocationProviderClient client;
    private final LocationCallback callback = new LocationCallback() {
        @Override
        public void onLocationResult(LocationResult result) {
            Location l = result.getLastLocation();
            if (l != null) onLocation(l);
        }
    };
    private double[] stopLat = new double[0], stopLon = new double[0];
    private String[] stopName = new String[0];
    private boolean[] arrived = new boolean[0], asked = new boolean[0];
    private double destLat, destLon;
    private long startedAt, lastSocAsk;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopTrip();
            return START_NOT_STICKY;
        }
        String trip = intent != null ? intent.getStringExtra(EXTRA_TRIP) : null;
        channels();
        Notification ongoing = ongoing("Yolculuğun takip ediliyor; molalarda sana haber vereceğiz.");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(ID_ONGOING, ongoing, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(ID_ONGOING, ongoing);
        }
        if (trip == null || !load(trip) || !hasLocation()) {
            stopTrip();
            return START_NOT_STICKY;
        }
        startedAt = System.currentTimeMillis();
        lastSocAsk = startedAt;
        if (client == null) client = LocationServices.getFusedLocationProviderClient(this);
        client.removeLocationUpdates(callback);
        LocationRequest request = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 20000)
                .setMinUpdateIntervalMillis(10000)
                .setMinUpdateDistanceMeters(50)
                .build();
        try {
            client.requestLocationUpdates(request, callback, Looper.getMainLooper());
        } catch (SecurityException e) {
            stopTrip();
        }
        return START_NOT_STICKY;
    }

    private boolean load(String trip) {
        try {
            JSONObject o = new JSONObject(trip);
            JSONObject d = o.getJSONObject("d");
            destLat = d.getDouble("la");
            destLon = d.getDouble("lo");
            JSONArray s = o.optJSONArray("s");
            int n = s == null ? 0 : s.length();
            stopLat = new double[n];
            stopLon = new double[n];
            stopName = new String[n];
            arrived = new boolean[n];
            asked = new boolean[n];
            for (int i = 0; i < n; i++) {
                JSONObject st = s.getJSONObject(i);
                stopLat[i] = st.getDouble("la");
                stopLon[i] = st.getDouble("lo");
                stopName[i] = st.optString("n", "Mola");
            }
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private void onLocation(Location l) {
        long now = System.currentTimeMillis();
        if (now - startedAt > MAX_TRIP_MS || distance(l, destLat, destLon) < 1500) {
            stopTrip();
            return;
        }
        boolean atStop = false;
        for (int i = 0; i < stopLat.length; i++) {
            float d = distance(l, stopLat[i], stopLon[i]);
            if (!arrived[i] && d <= 400) {
                arrived[i] = true;
                alert(10 + i, "Molaya vardın: " + stopName[i],
                        "Şarjı bitirince yüzde kaça doldurduğunu MolaVolt’a yaz; sonraki molaları ona göre ayarlayalım.",
                        "?mvCharge=" + i);
            }
            if (arrived[i] && !asked[i] && d > 1000) {
                asked[i] = true;
                lastSocAsk = now;
                alert(10 + i, "Şarjın yüzde kaça doldu?",
                        stopName[i] + " — dokun, göstergedeki değeri yaz.", "?mvCharge=" + i);
            }
            if (d <= 1000) atStop = true;
        }
        if (!atStop && now - lastSocAsk > SOC_EVERY_MS) {
            lastSocAsk = now;
            alert(5, "Şarjın kaç?", "Dokun, göstergedeki şarjı yaz; sonraki molanın yetip yetmediğine bakalım.", "?mvSoc=1");
        }
    }

    private static float distance(Location l, double lat, double lon) {
        float[] r = new float[1];
        Location.distanceBetween(l.getLatitude(), l.getLongitude(), lat, lon, r);
        return r[0];
    }

    private boolean hasLocation() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private PendingIntent open(String query, int code) {
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse("https://molavolt.com/" + query))
                .setPackage(getPackageName())
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(this, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private void alert(int id, String title, String text, String query) {
        Notification n = new NotificationCompat.Builder(this, CHANNEL_ALERTS)
                .setSmallIcon(R.drawable.ic_notification_icon)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setAutoCancel(true)
                .setContentIntent(open(query, id))
                .build();
        try {
            ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(id, n);
        } catch (SecurityException ignored) {
            // notifications are off for MolaVolt
        }
    }

    private Notification ongoing(String text) {
        Intent stop = new Intent(this, TripService.class).setAction(ACTION_STOP);
        PendingIntent stopPi = PendingIntent.getService(this, 1, stop, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CHANNEL_ONGOING)
                .setSmallIcon(R.drawable.ic_notification_icon)
                .setContentTitle("MolaVolt yolculuğunu takip ediyor")
                .setContentText(text)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setContentIntent(open("?mvTrip=1", 2))
                .addAction(0, "Durdur", stopPi)
                .build();
    }

    private void channels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL_ONGOING, "Yolculuk takibi", NotificationManager.IMPORTANCE_LOW));
        NotificationChannel alerts = new NotificationChannel(CHANNEL_ALERTS, "Mola ve şarj hatırlatmaları", NotificationManager.IMPORTANCE_HIGH);
        alerts.setDescription("Molaya varınca, moladan çıkınca ve yolda şarjını sormak için");
        nm.createNotificationChannel(alerts);
    }

    private void stopTrip() {
        if (client != null) client.removeLocationUpdates(callback);
        stopForeground(true);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        if (client != null) client.removeLocationUpdates(callback);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
