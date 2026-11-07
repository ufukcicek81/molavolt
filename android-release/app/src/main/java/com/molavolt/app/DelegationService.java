package com.molavolt.app;

import com.google.androidbrowserhelper.locationdelegation.LocationDelegationExtraCommandHandler;

/**
 * Lets the browser ask this app for the location, so first-time users see the Android
 * location permission prompt for MolaVolt (as in Google's Bubblewrap template).
 */
public class DelegationService extends
        com.google.androidbrowserhelper.trusted.DelegationService {
    @Override
    public void onCreate() {
        super.onCreate();
        registerExtraCommandHandler(new LocationDelegationExtraCommandHandler());
    }
}
