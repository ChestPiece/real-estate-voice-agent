-- isWithinCallingHours compares "HH:mm" strings, so only zero-padded 24h times are safe.
alter table agents
  add constraint calling_start_hhmm check (calling_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  add constraint calling_end_hhmm check (calling_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  add constraint calling_window_same_day check (calling_start < calling_end);
