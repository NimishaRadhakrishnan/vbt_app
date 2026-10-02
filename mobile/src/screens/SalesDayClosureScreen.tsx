import React, { useState, useEffect } from 'react';
import {
  ScrollView, View, Text, TouchableOpacity, StyleSheet, Alert,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiClient } from '../services/api';
import { showSubmitResult } from '../utils/offlineAlert';
import { FieldRow, TextInputLike, ChipPicker } from './dailyVisitTracker/FormFields';
import { color, font, fontWeight, spacing, radius } from '../theme';
import DynamicFieldRenderer from '../components/DynamicFieldRenderer';

// Mobile Sales Officer day closure - the counterpart to the web
// SalesDayClosureForm.tsx, hitting the same POST /day-closure/sales
// endpoint with the same payload shape.
//
// This screen exists because Sales Officers previously had NO reachable
// closure form on mobile at all: the logout gate sent them to
// DailyVisitTrackerScreen, which is registered only behind
// showFieldOfficerScreens and builds a farm-visit payload
// (farming_type/crop_status/farm_size_value are non-optional) that a
// Sales Officer could never validly submit. They were gated on
// something impossible.
//
// Deliberately ONE screen rather than the 9-step wizard used for the
// farm visit: this form is ~15 fields with no branching depth, and a
// wizard would add taps without adding clarity.

const DISTRICTS = ['Dindigul', 'Tiruppur', 'Coimbatore', 'Erode', 'Salem'];

// Kept in sync with the backend's VALIDATION_MESSAGE so web, mobile and
// server all show identical wording.
const OTHER_DESCRIPTION_MESSAGE = 'Please describe the other option.';

const VISIT_PURPOSES = [
  { value: 'dealer_visit', label: 'Dealer Visit' },
  { value: 'stock_audit', label: 'Stock Audit' },
  { value: 'order_booking', label: 'Order Booking' },
  { value: 'collection', label: 'Collection' },
  { value: 'fo_field_review', label: 'FO Field Review' },
  { value: 'new_dealer_onboarding', label: 'New Dealer Onboarding' },
  { value: 'competitor_intel', label: 'Competitor Intel' },
  { value: 'other', label: 'Other' },
];

const STOCK_STATUSES = [
  { value: 'adequate', label: 'Adequate Stock' },
  { value: 'low_reorder', label: 'Low Stock - Reorder' },
  { value: 'out_of_stock', label: 'Out of Stock' },
  { value: 'not_applicable', label: 'Not Applicable' },
];

function YesNo({ value, onChange }: { value: boolean | null; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.yesNoRow}>
      <TouchableOpacity
        style={[styles.yesNoBtn, value === true && styles.yesNoBtnActive]}
        onPress={() => onChange(true)}
      >
        <Text style={[styles.yesNoText, value === true && styles.yesNoTextActive]}>Yes</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.yesNoBtn, value === false && styles.yesNoBtnActive]}
        onPress={() => onChange(false)}
      >
        <Text style={[styles.yesNoText, value === false && styles.yesNoTextActive]}>No</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function SalesDayClosureScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();

  const [district, setDistrict] = useState<string | null>(null);
  const [dealerName, setDealerName] = useState('');
  const [village, setVillage] = useState('');
  const [dealerContact, setDealerContact] = useState('');
  const [visitPurpose, setVisitPurpose] = useState<string | null>(null);
  const [visitPurposeOther, setVisitPurposeOther] = useState('');
  const [purposeOptions, setPurposeOptions] = useState<any[]>(VISIT_PURPOSES);
  const [orderBooked, setOrderBooked] = useState<boolean | null>(null);
  const [orderValue, setOrderValue] = useState('');
  const [amountCollected, setAmountCollected] = useState('');
  const [newDealerDetails, setNewDealerDetails] = useState('');
  const [reviewedFoVisit, setReviewedFoVisit] = useState<boolean | null>(null);
  const [competitorActivity, setCompetitorActivity] = useState('');
  const [stockStatus, setStockStatus] = useState<string | null>(null);
  const [dayRating, setDayRating] = useState<number | null>(null);
  const [remarks, setRemarks] = useState('');
  const [dealerPhotos, setDealerPhotos] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const [customFields, setCustomFields] = useState<any[]>([]);
  const [customFieldAnswers, setCustomFieldAnswers] = useState<Record<string, any>>({});
  const [configVersion, setConfigVersion] = useState<number>(1);

  // Admin-configurable labels/required-ness, same source as web.
  const [cfg, setCfg] = useState<Record<string, { label: string; is_required: boolean }>>({});
  const [cfgLoaded, setCfgLoaded] = useState(false);

  useEffect(() => {
    apiClient.request('/custom-fields/day_closure', 'GET', 'task_action')
      .then((res: any) => {
        setCustomFields(res?.fields || []);
        if (res?.version) setConfigVersion(res.version);
      })
      .catch((err) => console.warn('Failed to load custom fields', err));

    apiClient.request('/day-closure-config', 'GET', 'task_action')
      .then((rows: any) => {
        const map: Record<string, { label: string; is_required: boolean }> = {};
        (rows || []).forEach((r: any) => {
          map[r.field_key] = { label: r.label, is_required: r.is_required };
        });
        setCfg(map);
        setCfgLoaded(true);
      })
      .catch(() => {
        // Config is an enhancement - the hardcoded fallbacks below keep
        // the form fully usable if this fetch fails.
      });

    // Fetched so requires_description is known per option. The
    // hardcoded VISIT_PURPOSES fallback has no flags, so if this fails
    // the description box simply never becomes mandatory - the form
    // stays usable rather than blocking submission on data we do not
    // have.
    apiClient.request('/enum-options/sales_visit_purpose', 'GET', 'task_action')
      .then((rows: any) => { if (rows?.length) setPurposeOptions(rows); })
      .catch(() => {});
  }, []);

  // Flag-driven, never value === 'other', so admin-created options are
  // covered without shipping new code.
  const purposeNeedsDesc = !!purposeOptions.find(
    (o: any) => o.value === visitPurpose && o.requires_description);

  // Approved rule: switching to an option that does not need a
  // description clears the text, so an abandoned value is never
  // submitted against the wrong option.
  useEffect(() => {
    if (!purposeNeedsDesc && visitPurposeOther) setVisitPurposeOther('');
  }, [purposeNeedsDesc]);

  const visible = (key: string) => !cfgLoaded || key in cfg;
  const label = (key: string, fallback: string) => cfg[key]?.label ?? fallback;
  const required = (key: string, fallback: boolean) => {
    if (!visible(key)) return false;
    return cfg[key]?.is_required ?? fallback;
  };

  const pickPhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Camera Needed', 'Allow camera access to attach a dealer shop photo.');
      return;
    }
    const res = await ImagePicker.launchCameraAsync({ quality: 0.6 });
    if (!res.canceled && res.assets?.[0]?.uri) {
      setDealerPhotos((p) => [...p, res.assets[0].uri]);
    }
  };

  // "No activity today" - an officer who was sick, travelling or in
  // training has nothing valid to submit otherwise, and with 17:30
  // logout enforcement live they would be unable to sign out at all.
  // A short reason is required (backend + DB CHECK both enforce it).
  //
  // Rendered as an in-screen panel rather than Alert.prompt(): that API
  // is iOS-ONLY and is a silent no-op on Android, which would have left
  // this button dead for most of the fleet.
  const [showNoActivity, setShowNoActivity] = useState(false);
  const [noActivityReason, setNoActivityReason] = useState('');

  const submitNoActivity = async () => {
    if (!noActivityReason.trim()) {
      Alert.alert('Reason Needed', 'Please give a short reason for having no activity today.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiClient.request('/day-closure/no-activity', 'POST', 'task_action', {
        reason: noActivityReason.trim(),
      });
      showSubmitResult(res, 'Day Closed', 'Recorded as no activity today. You can now sign out.');
      navigation.goBack();
    } catch (err: any) {
      Alert.alert('Could Not Submit', err.message || 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    const missing: string[] = [];
    if (required('sales_district', true) && !district) missing.push('District');
    if (required('sales_dealer_name', true) && !dealerName.trim()) missing.push('Dealer name');
    if (required('sales_visit_purpose', true) && !visitPurpose) missing.push('Visit purpose');
    if (required('sales_amount_collected', true) && !amountCollected) missing.push('Amount collected');
    if (required('sales_remarks', true) && !remarks.trim()) missing.push('Remarks');
    if (purposeNeedsDesc && !visitPurposeOther.trim()) {
      Alert.alert('Description Needed', OTHER_DESCRIPTION_MESSAGE);
      return;
    }
    if (missing.length) {
      Alert.alert('Missing Information', `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} required.`);
      return;
    }

    setSubmitting(true);
    try {
      // Photos are uploaded first so the closure payload carries real
      // URLs. A failed upload must not silently drop the photo, so it
      // surfaces before the closure is submitted rather than after.
      const images: { image_url: string; image_type: string }[] = [];
      for (const uri of dealerPhotos) {
        const url = await apiClient.uploadFile(
          '/day-closure/upload', uri, `sales-closure-${Date.now()}.jpg`, 'image/jpeg',
        );
        images.push({ image_url: url, image_type: 'dealer_shop' });
      }

      const res = await apiClient.request('/day-closure/sales', 'POST', 'task_action', {
        district,
        dealer_name: dealerName.trim(),
        village: village.trim() || null,
        dealer_contact: dealerContact.trim() || null,
        visit_purpose: visitPurpose,
        visit_purpose_other_text: purposeNeedsDesc ? visitPurposeOther.trim() : null,
        order_booked: orderBooked,
        order_value: orderValue ? parseFloat(orderValue) : null,
        amount_collected: amountCollected ? parseFloat(amountCollected) : null,
        new_dealer_details: newDealerDetails.trim() || null,
        reviewed_fo_visit: reviewedFoVisit,
        competitor_activity: competitorActivity.trim() || null,
        stock_status: stockStatus,
        day_rating: dayRating,
        remarks: remarks.trim() || null,
        images,
        config_version: configVersion,
        custom_field_answers: customFieldAnswers,
      });

      showSubmitResult(res, 'Day Closure Submitted', "Today's closure has been recorded.");
      navigation.goBack();
    } catch (err: any) {
      Alert.alert('Could Not Submit', err.message || 'Please check the form and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.sectionHeader}>Visit &amp; Dealer Details</Text>

        {visible('sales_district') && (
          <FieldRow label={label('sales_district', 'District')}>
            <ChipPicker
              options={DISTRICTS.map((d) => ({ value: d, label: d }))}
              value={district}
              onChange={setDistrict}
            />
          </FieldRow>
        )}
        {visible('sales_dealer_name') && (
          <FieldRow label={label('sales_dealer_name', 'Dealer / Distributor Name')}>
            <TextInputLike value={dealerName} onChangeText={setDealerName} placeholder="One dealer per closure" />
          </FieldRow>
        )}
        {visible('sales_village') && (
          <FieldRow label={label('sales_village', 'Village / Location')}>
            <TextInputLike value={village} onChangeText={setVillage} placeholder="Village or area" />
          </FieldRow>
        )}
        {visible('sales_dealer_contact') && (
          <FieldRow label={label('sales_dealer_contact', 'Contact Number')}>
            <TextInputLike value={dealerContact} onChangeText={setDealerContact} placeholder="Phone number" />
          </FieldRow>
        )}
        {visible('sales_visit_purpose') && (
          <FieldRow label={label('sales_visit_purpose', 'Visit Purpose')}>
            <ChipPicker options={purposeOptions} value={visitPurpose} onChange={setVisitPurpose} />
          </FieldRow>
        )}
        {/* Shown only while the chosen option requires it. Switching
            away clears the text via the effect above, mirroring the
            web behaviour. */}
        {purposeNeedsDesc && (
          <FieldRow label="Please specify">
            <TextInputLike
              value={visitPurposeOther}
              onChangeText={setVisitPurposeOther}
              placeholder="Describe the other option"
            />
          </FieldRow>
        )}

        <Text style={styles.sectionHeader}>Orders &amp; Collection</Text>

        {visible('sales_order_booked') && (
          <FieldRow label={label('sales_order_booked', 'Was an Order Booked?')}>
            <YesNo value={orderBooked} onChange={setOrderBooked} />
          </FieldRow>
        )}
        {/* Only asked once an order was actually booked - prompting for
            a value after "No" invites a meaningless zero. */}
        {orderBooked === true && visible('sales_order_value') && (
          <FieldRow label={label('sales_order_value', 'Order Value (Rs)')}>
            <TextInputLike value={orderValue} onChangeText={setOrderValue} placeholder="0" keyboardType="numeric" />
          </FieldRow>
        )}
        {visible('sales_amount_collected') && (
          <FieldRow label={label('sales_amount_collected', 'Amount Collected (Rs)')}>
            <TextInputLike value={amountCollected} onChangeText={setAmountCollected} placeholder="0" keyboardType="numeric" />
          </FieldRow>
        )}
        {visible('sales_new_dealer') && (
          <FieldRow label={label('sales_new_dealer', 'New Dealer Onboarded Today?')}>
            <TextInputLike
              value={newDealerDetails}
              onChangeText={setNewDealerDetails}
              placeholder="Name and contact, or write No"
            />
          </FieldRow>
        )}

        <Text style={styles.sectionHeader}>Field &amp; Market Intelligence</Text>

        {visible('sales_fo_review') && (
          <FieldRow label={label('sales_fo_review', 'Reviewed / Accompanied an FO Visit?')}>
            <YesNo value={reviewedFoVisit} onChange={setReviewedFoVisit} />
          </FieldRow>
        )}
        {visible('sales_competitor_activity') && (
          <FieldRow label={label('sales_competitor_activity', 'Competitor Activity Observed?')}>
            <TextInputLike
              value={competitorActivity}
              onChangeText={setCompetitorActivity}
              placeholder="Pricing, promotions, new products"
            />
          </FieldRow>
        )}
        {visible('sales_stock_status') && (
          <FieldRow label={label('sales_stock_status', 'Dealer Stock Status')}>
            <ChipPicker options={STOCK_STATUSES} value={stockStatus} onChange={setStockStatus} />
          </FieldRow>
        )}

        <Text style={styles.sectionHeader}>Rating &amp; Follow-up</Text>

        {visible('sales_day_rating') && (
          <FieldRow label={label('sales_day_rating', 'Rating of Visit / Day')}>
            <View style={styles.ratingRow}>
              <Text style={styles.ratingEnd}>Poor</Text>
              {[1, 2, 3, 4, 5].map((n) => (
                <TouchableOpacity
                  key={n}
                  style={[styles.ratingDot, dayRating === n && styles.ratingDotActive]}
                  onPress={() => setDayRating(n)}
                  hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                >
                  <Text style={[styles.ratingNum, dayRating === n && styles.ratingNumActive]}>{n}</Text>
                </TouchableOpacity>
              ))}
              <Text style={styles.ratingEnd}>Excellent</Text>
            </View>
          </FieldRow>
        )}
        {visible('sales_remarks') && (
          <FieldRow label={label('sales_remarks', 'Remarks / Next Follow-up Plan')}>
            <TextInputLike value={remarks} onChangeText={setRemarks} placeholder="What needs following up" />
          </FieldRow>
        )}
        {visible('sales_dealer_photos') && (
          <FieldRow label={label('sales_dealer_photos', 'Dealer Shop Photo')}>
            <TouchableOpacity style={styles.photoBtn} onPress={pickPhoto}>
              <Text style={styles.photoBtnText}>
                {dealerPhotos.length > 0 ? `${dealerPhotos.length} photo(s) — add another` : 'Take Photo'}
              </Text>
            </TouchableOpacity>
          </FieldRow>
        )}

        {customFields.length > 0 && (
          <View style={{ marginTop: spacing.lg, backgroundColor: color.cardBg, borderRadius: radius.md, borderWidth: 1, borderColor: color.border, padding: spacing.lg }}>
            <Text style={{ fontSize: font.body, fontWeight: fontWeight.bold, color: color.textPrimary, marginBottom: spacing.sm }}>Additional Information</Text>
            <DynamicFieldRenderer
              fields={customFields}
              answers={customFieldAnswers}
              onChange={(key, val) => setCustomFieldAnswers(prev => ({ ...prev, [key]: val }))}
            />
          </View>
        )}

        <View style={{ height: spacing.xxl * 2 }} />
      </ScrollView>

      {/* Footer padded past the home indicator so Submit is never
          clipped on gesture-nav devices. */}
      <View style={[styles.footer, { paddingBottom: spacing.lg + insets.bottom }]}>
        <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit} disabled={submitting}>
          {submitting ? (
            <ActivityIndicator color={color.white} />
          ) : (
            <Text style={styles.submitBtnText}>Submit Day Closure</Text>
          )}
        </TouchableOpacity>

        {!showNoActivity ? (
          <TouchableOpacity style={styles.noActivityBtn} onPress={() => setShowNoActivity(true)} disabled={submitting}>
            <Text style={styles.noActivityText}>No activity today</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.noActivityPanel}>
            <Text style={styles.noActivityLabel}>Short reason (required)</Text>
            <TextInputLike
              value={noActivityReason}
              onChangeText={setNoActivityReason}
              placeholder="e.g. On sick leave, travelling"
            />
            <View style={styles.noActivityRow}>
              <TouchableOpacity onPress={() => { setShowNoActivity(false); setNoActivityReason(''); }}>
                <Text style={styles.noActivityCancel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.noActivityConfirm} onPress={submitNoActivity} disabled={submitting}>
                <Text style={styles.noActivityConfirmText}>Submit</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.screenBg },
  sectionHeader: {
    fontSize: font.caption,
    fontWeight: fontWeight.bold,
    color: color.textMuted,
    textTransform: 'uppercase',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.sm,
  },
  yesNoRow: { flexDirection: 'row', gap: spacing.sm },
  yesNoBtn: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.cardBg,
  },
  yesNoBtnActive: { backgroundColor: color.primary, borderColor: color.primary },
  yesNoText: { fontSize: font.body, color: color.textSecondary, fontWeight: fontWeight.semibold },
  yesNoTextActive: { color: color.white },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  ratingEnd: { fontSize: font.caption, color: color.textMuted },
  ratingDot: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: color.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.cardBg,
  },
  ratingDotActive: { borderColor: color.primary, backgroundColor: color.primary },
  ratingNum: { fontSize: font.body, fontWeight: fontWeight.semibold, color: color.textSecondary },
  ratingNumActive: { color: color.white },
  photoBtn: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.primary,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  photoBtnText: { color: color.primary, fontWeight: fontWeight.semibold, fontSize: font.body },
  footer: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: color.border,
    backgroundColor: color.cardBg,
  },
  submitBtn: {
    backgroundColor: color.primary,
    borderRadius: radius.sm,
    paddingVertical: 16,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  submitBtnText: { color: color.white, fontWeight: fontWeight.bold, fontSize: font.subtitle },
  noActivityBtn: {
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.border,
    borderRadius: radius.sm,
  },
  noActivityText: { color: color.textSecondary, fontWeight: fontWeight.semibold, fontSize: font.body },
  noActivityPanel: {
    marginTop: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    backgroundColor: color.cardBg,
  },
  noActivityLabel: {
    fontSize: font.caption,
    fontWeight: fontWeight.semibold,
    color: color.textSecondary,
    marginBottom: spacing.sm,
  },
  noActivityRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: spacing.lg,
    marginTop: spacing.md,
  },
  noActivityCancel: { color: color.textMuted, fontWeight: fontWeight.semibold, fontSize: font.body },
  noActivityConfirm: {
    backgroundColor: color.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.sm,
  },
  noActivityConfirmText: { color: color.white, fontWeight: fontWeight.bold, fontSize: font.body },
});
