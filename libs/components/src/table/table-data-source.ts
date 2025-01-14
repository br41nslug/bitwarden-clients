import { _isNumberValue } from "@angular/cdk/coercion";
import { DataSource } from "@angular/cdk/collections";
import { BehaviorSubject, combineLatest, map, Observable, Subscription } from "rxjs";

export type SortDirection = "asc" | "desc";
export type SortFn = (a: any, b: any) => number;
export type Sort = {
  column?: string;
  direction: SortDirection;
  fn?: SortFn;
};

// Loosely based on CDK TableDataSource
//  https://github.com/angular/components/blob/main/src/material/table/table-data-source.ts
export class TableDataSource<T> extends DataSource<T> {
  private readonly _data: BehaviorSubject<T[]>;
  private readonly _sort: BehaviorSubject<Sort>;
  private readonly _filter = new BehaviorSubject<string>("");
  private readonly _renderData = new BehaviorSubject<T[]>([]);

  private _renderChangesSubscription: Subscription | null = null;

  constructor() {
    super();
    this._data = new BehaviorSubject([]);
    this._sort = new BehaviorSubject({ direction: "asc" });
  }

  get data() {
    return this._data.value;
  }

  set data(data: T[]) {
    this._data.next(data ? [...data] : []);
  }

  set sort(sort: Sort) {
    this._sort.next(sort);
  }

  get sort() {
    return this._sort.value;
  }

  get filter() {
    return this._filter.value;
  }

  set filter(filter: string) {
    this._filter.next(filter);
  }

  connect(): Observable<readonly T[]> {
    if (!this._renderChangesSubscription) {
      this.updateChangeSubscription();
    }

    return this._renderData;
  }

  disconnect(): void {
    this._renderChangesSubscription?.unsubscribe();
    this._renderChangesSubscription = null;
  }

  private updateChangeSubscription() {
    const filteredData = combineLatest([this._data, this._filter]).pipe(
      map(([data, filter]) => this.filterData(data, filter))
    );

    const orderedData = combineLatest([filteredData, this._sort]).pipe(
      map(([data, sort]) => this.orderData(data, sort))
    );

    this._renderChangesSubscription?.unsubscribe();
    this._renderChangesSubscription = orderedData.subscribe((data) => this._renderData.next(data));
  }

  private filterData(data: T[], filter: string): T[] {
    if (filter == null || filter == "") {
      return data;
    }

    return data.filter((obj) => this.filterPredicate(obj, filter));
  }

  private orderData(data: T[], sort: Sort): T[] {
    if (!sort) {
      return data;
    }

    return this.sortData(data, sort);
  }

  /**
   * Copied from https://github.com/angular/components/blob/main/src/material/table/table-data-source.ts
   * License: MIT
   * Copyright (c) 2022 Google LLC.
   *
   * Data accessor function that is used for accessing data properties for sorting through
   * the default sortData function.
   * This default function assumes that the sort header IDs (which defaults to the column name)
   * matches the data's properties (e.g. column Xyz represents data['Xyz']).
   * May be set to a custom function for different behavior.
   * @param data Data object that is being accessed.
   * @param sortHeaderId The name of the column that represents the data.
   */
  protected sortingDataAccessor(data: T, sortHeaderId: string): string | number {
    const value = (data as unknown as Record<string, any>)[sortHeaderId];

    if (_isNumberValue(value)) {
      const numberValue = Number(value);

      return numberValue < Number.MAX_SAFE_INTEGER ? numberValue : value;
    }

    return value;
  }

  /**
   * Copied from https://github.com/angular/components/blob/main/src/material/table/table-data-source.ts
   * License: MIT
   * Copyright (c) 2022 Google LLC.
   *
   * Gets a sorted copy of the data array based on the state of the MatSort. Called
   * after changes are made to the filtered data or when sort changes are emitted from MatSort.
   * By default, the function retrieves the active sort and its direction and compares data
   * by retrieving data using the sortingDataAccessor. May be overridden for a custom implementation
   * of data ordering.
   * @param data The array of data that should be sorted.
   * @param sort The connected MatSort that holds the current sort state.
   */
  protected sortData(data: T[], sort: Sort): T[] {
    const column = sort.column;
    const direction = sort.direction;
    if (!column) {
      return data;
    }

    return data.sort((a, b) => {
      // If a custom sort function is provided, use it instead of the default.
      if (sort.fn) {
        return sort.fn(a, b) * (direction === "asc" ? 1 : -1);
      }

      let valueA = this.sortingDataAccessor(a, column);
      let valueB = this.sortingDataAccessor(b, column);

      // If there are data in the column that can be converted to a number,
      // it must be ensured that the rest of the data
      // is of the same type so as not to order incorrectly.
      const valueAType = typeof valueA;
      const valueBType = typeof valueB;

      if (valueAType !== valueBType) {
        if (valueAType === "number") {
          valueA += "";
        }
        if (valueBType === "number") {
          valueB += "";
        }
      }

      // If both valueA and valueB exist (truthy), then compare the two. Otherwise, check if
      // one value exists while the other doesn't. In this case, existing value should come last.
      // This avoids inconsistent results when comparing values to undefined/null.
      // If neither value exists, return 0 (equal).
      let comparatorResult = 0;
      if (valueA != null && valueB != null) {
        // Check if one value is greater than the other; if equal, comparatorResult should remain 0.
        if (valueA > valueB) {
          comparatorResult = 1;
        } else if (valueA < valueB) {
          comparatorResult = -1;
        }
      } else if (valueA != null) {
        comparatorResult = 1;
      } else if (valueB != null) {
        comparatorResult = -1;
      }

      return comparatorResult * (direction === "asc" ? 1 : -1);
    });
  }

  /**
   * Copied from https://github.com/angular/components/blob/main/src/material/table/table-data-source.ts
   * License: MIT
   * Copyright (c) 2022 Google LLC.
   *
   * Checks if a data object matches the data source's filter string. By default, each data object
   * is converted to a string of its properties and returns true if the filter has
   * at least one occurrence in that string. By default, the filter string has its whitespace
   * trimmed and the match is case-insensitive. May be overridden for a custom implementation of
   * filter matching.
   * @param data Data object used to check against the filter.
   * @param filter Filter string that has been set on the data source.
   * @returns Whether the filter matches against the data
   */
  protected filterPredicate(data: T, filter: string): boolean {
    // Transform the data into a lowercase string of all property values.
    const dataStr = Object.keys(data as unknown as Record<string, any>)
      .reduce((currentTerm: string, key: string) => {
        // Use an obscure Unicode character to delimit the words in the concatenated string.
        // This avoids matches where the values of two columns combined will match the user's query
        // (e.g. `Flute` and `Stop` will match `Test`). The character is intended to be something
        // that has a very low chance of being typed in by somebody in a text field. This one in
        // particular is "White up-pointing triangle with dot" from
        // https://en.wikipedia.org/wiki/List_of_Unicode_characters
        return currentTerm + (data as unknown as Record<string, any>)[key] + "◬";
      }, "")
      .toLowerCase();

    // Transform the filter by converting it to lowercase and removing whitespace.
    const transformedFilter = filter.trim().toLowerCase();

    return dataStr.indexOf(transformedFilter) != -1;
  }
}
