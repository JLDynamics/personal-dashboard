#import <EventKit/EventKit.h>
#import <Foundation/Foundation.h>

static BOOL CalendarIsUseful(EKCalendar *calendar) {
  if (calendar.type == EKCalendarTypeBirthday ||
      calendar.type == EKCalendarTypeSubscription) {
    return NO;
  }
  NSString *name = calendar.title.lowercaseString;
  NSArray<NSString *> *excluded = @[
    @"birthday",
    @"holiday",
    @"siri suggestions",
    @"scheduled reminders"
  ];
  for (NSString *term in excluded) {
    if ([name containsString:term]) return NO;
  }
  return YES;
}

static NSString *CleanString(NSString *value, NSUInteger limit) {
  if (![value isKindOfClass:NSString.class]) return @"";
  NSString *cleaned = [value stringByTrimmingCharactersInSet:
      NSCharacterSet.whitespaceAndNewlineCharacterSet];
  cleaned = [cleaned componentsSeparatedByCharactersInSet:
      NSCharacterSet.newlineCharacterSet].firstObject ?: @"";
  if (cleaned.length > limit) {
    cleaned = [cleaned substringToIndex:limit];
  }
  return cleaned;
}

int main(void) {
  @autoreleasepool {
    EKEventStore *store = [[EKEventStore alloc] init];
    EKAuthorizationStatus status =
        [EKEventStore authorizationStatusForEntityType:EKEntityTypeEvent];
    __block BOOL granted = status == EKAuthorizationStatusFullAccess;

    if (!granted) {
      dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
      [store requestFullAccessToEventsWithCompletion:
          ^(BOOL allowed, NSError *error) {
            granted = allowed;
            dispatch_semaphore_signal(semaphore);
          }];
      dispatch_semaphore_wait(
          semaphore,
          dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC));
    }

    if (!granted) {
      fprintf(stderr, "Calendar access was not granted.\n");
      return 2;
    }

    NSDate *start = NSDate.date;
    NSDate *end = [start dateByAddingTimeInterval:7 * 24 * 60 * 60];
    NSMutableArray<EKCalendar *> *calendars = [NSMutableArray array];
    for (EKCalendar *calendar in
         [store calendarsForEntityType:EKEntityTypeEvent]) {
      if (CalendarIsUseful(calendar)) [calendars addObject:calendar];
    }

    NSPredicate *predicate =
        [store predicateForEventsWithStartDate:start
                                       endDate:end
                                     calendars:calendars];
    NSArray<EKEvent *> *events =
        [[store eventsMatchingPredicate:predicate]
            sortedArrayUsingComparator:
                ^NSComparisonResult(EKEvent *left, EKEvent *right) {
                  return [left.startDate compare:right.startDate];
                }];

    NSISO8601DateFormatter *formatter = [[NSISO8601DateFormatter alloc] init];
    formatter.formatOptions =
        NSISO8601DateFormatWithInternetDateTime |
        NSISO8601DateFormatWithFractionalSeconds;
    NSMutableArray<NSDictionary *> *items = [NSMutableArray array];
    NSMutableSet<NSString *> *seen = [NSMutableSet set];

    for (EKEvent *event in events) {
      NSString *title = CleanString(event.title, 180);
      NSString *calendarName = CleanString(event.calendar.title, 80);
      if (title.length == 0 || calendarName.length == 0) continue;
      NSString *startAt = [formatter stringFromDate:event.startDate];
      NSString *endAt = [formatter stringFromDate:event.endDate];
      NSString *dedupeKey =
          [NSString stringWithFormat:@"%@|%@|%@", title.lowercaseString,
                                     startAt, endAt];
      if ([seen containsObject:dedupeKey]) continue;
      [seen addObject:dedupeKey];

      NSString *identifier =
          CleanString(event.eventIdentifier, 160);
      if (identifier.length == 0) identifier = dedupeKey;
      NSString *location = CleanString(event.location, 140);
      NSMutableDictionary *item = [@{
        @"id": identifier,
        @"title": title,
        @"startAt": startAt,
        @"endAt": endAt,
        @"allDay": @(event.allDay),
        @"calendarName": calendarName
      } mutableCopy];
      if (location.length > 0) item[@"location"] = location;
      [items addObject:item];
      if (items.count == 8) break;
    }

    NSDictionary *payload = @{
      @"items": items,
      @"rangeStart": [formatter stringFromDate:start],
      @"rangeEnd": [formatter stringFromDate:end]
    };
    NSError *error = nil;
    NSData *json = [NSJSONSerialization dataWithJSONObject:payload
                                                   options:0
                                                     error:&error];
    if (!json || error) {
      fprintf(stderr, "Calendar output could not be encoded.\n");
      return 3;
    }
    fwrite(json.bytes, 1, json.length, stdout);
    fputc('\n', stdout);
  }
  return 0;
}
