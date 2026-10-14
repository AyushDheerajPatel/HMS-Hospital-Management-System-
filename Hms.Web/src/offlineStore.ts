import type { Appointment, Patient } from "./api";

export type CachedPatient = Pick<
  Patient,
  "id" | "firstName" | "lastName" | "status"
>;

export type OfflineAppointment = {
  operationId: string;
  tenantId: string;
  userId?: string;
  doctorId?: string;
  patientId: string;
  scheduledAtUtc: string;
  reason?: string;
  state: "pending" | "syncing" | "synced" | "failed";
  retryable: boolean;
  retryCount: number;
  nextAttemptAtUtc?: string;
  message?: string;
  syncedAtUtc?: string;
  serverAppointmentId?: string;
  confirmedAppointment?: Appointment;
};

const DATABASE_NAME = "hms-offline";
const DATABASE_VERSION = 1;
const PATIENT_STORE = "patients";
const APPOINTMENT_STORE = "appointment-operations";

let databasePromise: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (!("indexedDB" in window)) {
    return Promise.reject(new Error("This browser does not support offline storage."));
  }

  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        const patients = database.createObjectStore(PATIENT_STORE, {
          keyPath: "key",
        });
        patients.createIndex("tenantId", "tenantId", { unique: false });
        const appointments = database.createObjectStore(APPOINTMENT_STORE, {
          keyPath: "operationId",
        });
        appointments.createIndex("tenantId", "tenantId", { unique: false });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        databasePromise = undefined;
        reject(request.error ?? new Error("Unable to open offline storage."));
      };
      request.onblocked = () => {
        databasePromise = undefined;
        reject(new Error("Offline storage is blocked by another browser tab."));
      };
    });
  }

  return databasePromise;
}

async function transact<T>(
  storeNames: string[],
  mode: IDBTransactionMode,
  action: (transaction: IDBTransaction) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeNames, mode);
    const request = action(transaction);
    let result: T;
    request.onsuccess = () => {
      result = request.result;
    };
    request.onerror = () => {
      reject(request.error ?? new Error("Offline storage request failed."));
    };
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => {
      reject(transaction.error ?? new Error("Offline storage transaction failed."));
    };
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Offline storage transaction aborted."));
  });
}

export async function savePatients(
  tenantId: string,
  patients: Patient[],
): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(PATIENT_STORE, "readwrite");
    const store = transaction.objectStore(PATIENT_STORE);
    for (const patient of patients) {
      const minimal: CachedPatient & { key: string; tenantId: string } = {
        key: `${tenantId}:${patient.id}`,
        tenantId,
        id: patient.id,
        firstName: patient.firstName,
        lastName: patient.lastName,
        status: patient.status,
      };
      store.put(minimal);
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Unable to save offline patient data."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Offline patient save was aborted."));
  });
}

export async function getPatients(
  tenantId: string,
): Promise<CachedPatient[]> {
  return transact(
    [PATIENT_STORE],
    "readonly",
    (transaction) =>
      transaction.objectStore(PATIENT_STORE).index("tenantId").getAll(tenantId),
  );
}

export async function addAppointment(
  appointment: OfflineAppointment,
): Promise<void> {
  await transact(
    [APPOINTMENT_STORE],
    "readwrite",
    (transaction) =>
      transaction.objectStore(APPOINTMENT_STORE).add(appointment),
  );
}

export async function saveAppointment(
  appointment: OfflineAppointment,
): Promise<void> {
  await transact(
    [APPOINTMENT_STORE],
    "readwrite",
    (transaction) =>
      transaction.objectStore(APPOINTMENT_STORE).put(appointment),
  );
}

export async function removeAppointment(
  operationId: string,
): Promise<void> {
  await transact(
    [APPOINTMENT_STORE],
    "readwrite",
    (transaction) =>
      transaction.objectStore(APPOINTMENT_STORE).delete(operationId),
  );
}

export async function getAppointments(
  tenantId: string,
): Promise<OfflineAppointment[]> {
  return transact(
    [APPOINTMENT_STORE],
    "readonly",
    (transaction) =>
      transaction.objectStore(APPOINTMENT_STORE).index("tenantId").getAll(tenantId),
  );
}

export async function removeTenantData(
  tenantId: string,
  ownerUserId?: string,
  discardOwnedOperations = false,
): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(
      [PATIENT_STORE, APPOINTMENT_STORE],
      "readwrite",
    );
    for (const storeName of [PATIENT_STORE, APPOINTMENT_STORE]) {
      const store = transaction.objectStore(storeName);
      const request = store.index("tenantId").openCursor(IDBKeyRange.only(tenantId));
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const operation = storeName === APPOINTMENT_STORE
            ? cursor.value as OfflineAppointment
            : undefined;
          if (
            !operation ||
            operation.state === "synced" ||
            (discardOwnedOperations &&
              ownerUserId !== undefined &&
              operation.userId === ownerUserId)
          ) {
            store.delete(cursor.primaryKey);
          }
          cursor.continue();
        }
      };
      request.onerror = () =>
        transaction.abort();
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Unable to clear offline data."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Offline data cleanup was aborted."));
  });
}
