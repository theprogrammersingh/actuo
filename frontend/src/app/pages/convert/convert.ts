import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Card } from '../../ui';
import { CurrencyConverter } from '../../converter/currency-converter.js';
import { ConverterSession } from '../../converter/converter-session.js';

/** The surface id this page claims. See `ConverterSession.open`. */
const SURFACE = 'convert';

/**
 * `/convert` — the converter as a page of its own.
 *
 * The other three placements are contextual: an expense row, the dashboard's
 * excluded-rows notice, and `/agent`. This one is the plain answer to "I just
 * want to convert something", and the only surface that opens the frame on
 * arrival, since it is the entire reason to be here.
 *
 * Deliberately **not** a seventh nav tab. The bottom bar is measured tight at
 * six on a 390px phone (Progress.md), and `/showcase` is the existing precedent
 * for a route reachable without one. It is linked from the places the question
 * actually comes up.
 */
@Component({
  selector: 'app-convert',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Card, CurrencyConverter, RouterLink],
  template: `
    <div class="mx-auto w-full max-w-3xl space-y-6">
      <header>
        <h1 class="font-display text-2xl font-semibold text-body">Currency converter</h1>
        <p class="mt-1 text-sm text-muted">
          Live and historical European Central Bank rates, from a separate app embedded here.
          It is a reference: nothing you do on this page changes an Actuo figure.
        </p>
      </header>

      <ui-card padding="lg">
        <app-currency-converter
          [surface]="surface"
          height="full"
          title="Currency converter"
        />
      </ui-card>

      <ui-card padding="lg">
        <header uiCardHeader class="mb-2">
          <h2 class="font-display text-lg font-semibold text-body">Why totals still exclude it</h2>
        </header>
        <p class="text-sm text-muted">
          Actuo stores every expense in the currency it was filed in, and converts one to your
          base currency only when a rate was locked at the time it was recorded. A rate looked
          up today is not that rate, so a conversion here is never folded into a total — the
          dashboard and budgets say how many rows they left out instead of quietly adding
          dollars to rupees.
        </p>
        <p class="mt-3 text-sm text-muted">
          The converter is also a live WebMCP surface. With the Copilot open you can ask it to
          convert, and it drives this same embedded app —
          <a
            routerLink="/agent"
            class="underline decoration-line underline-offset-2 hover:text-body"
            >see what it exposes</a
          >.
        </p>
      </ui-card>
    </div>
  `,
})
export class Convert implements OnInit {
  private readonly session = inject(ConverterSession);

  protected readonly surface = SURFACE;

  ngOnInit(): void {
    // The page's whole purpose, so it opens rather than offering a trigger.
    this.session.open(SURFACE);
  }
}
