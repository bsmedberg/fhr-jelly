$(function() {
    // Hide the loading animation as soon as the DOM is ready.
    $('.loading').hide();

    var navListItems = $('.nav li');
    var rawTabs = $('#raw_selector').find('li a');
    var navItems = navListItems.find('a');
    var contentContainers = $('.mainContent');
    var rawContentContainers = $('.rawdata-display');
    var rawHeadings = $('.raw_heading');

    var showContainer = function(anchor) {
        // Get the id of the container to show from the href.
        var containerId = anchor.attr('href');
        var container = $(containerId);
        container.show();
    };

    // Handle clicks on the main presistent header.
    navItems.click(function(event) {
        event.preventDefault();
        // Ensure all content containers are hidden.
        contentContainers.hide();
        // Remove the active class from all links.
        navItems.removeClass('active');
        // Set the clicked links to active.
        $(this).addClass('active');

        showContainer($(this));
    });

    // Handle tab clicks on the raw data view.
    rawTabs.click(function(event) {
        event.preventDefault();
        // Ensure all content containers are hidden.
        rawContentContainers.hide();
        rawHeadings.hide();

        // Deactivate all tabs
        rawTabs.removeClass('active');
        // Set the clicked anchor to active
        $(this).addClass('active');

        showContainer($(this), true);
        $($(this).attr('href') + '_heading').show();
    });

    // Show and hide the statistics for viewports less than 768px
    var showStatistics = $('#showstats');
    var statsBox = $('.statsBox');
    var statsBoxSection = $('.statsBoxSection');

    showStatistics.click(function(event) {
        event.preventDefault();

        statsBox.toggleClass('show');
        statsBoxSection.toggleClass('show');
    });

    // Tip Boxes
    // Handle close button clicks on tip boxes.
    $('.closeTip').mouseup(function() {
        var tipBox = $(this).parent();
        tipBox.hide('slow');
    });

    // Collapse and Expand Tip Box.
    $('.tipBox-header').click(function() {
        var tipboxContent = $(this).next('.tipBox-content');

        tipboxContent.toggleClass('collapse');
        $(this).find('.expanderArrow').toggleClass('collapse');
        tipboxContent.find('.buttonRow').toggleClass('collapse');
    });
});

// Paints the startup times onto the main graph.
// @param graphData an list of [[mssinceepoch, stime_ms]], for example:
//     [['1360108800000', 657], ['1360108800000', 989]]

function drawGraph(startupTimes) {
    // This can be called before the page is ready, so wrap it in a ready
    // blocker.
    $(function() {
        $('.graphbox').show();
        var graphContainer = $('.graph');
        var currentLocale = $('html').attr('lang');

        // We need to localize our month names so first load our localized data,
        // then set the graph options and draw the graph.
        $.getJSON('js/locale/date_format.json', function(data) {
            var options = {
                colors: ['#50B432'],
                series: {
                      points: {
                          show: true,
                          radius: 5
                      }
                  },
                  xaxis: {
                      mode: 'time',
                      monthNames: data[currentLocale].monthNameShort.split(','),
                      show: true,
                  }
              };

            var graph = $.plot(graphContainer, [startupTimes], options);
            // We are drawing a graph so show the Y-label.
            $('.yaxis-label').show();
        }).fail(function(jqxhr, textStatus, error) {
            var errorTxt = textStatus + '[' + error + ']';
            graphContainer.text('The following error occurred while drawing the graph: ' + errorTxt);
        });
    });
};

    // Conditionally show tip boxes
    function showTipboxes(payload) {
        clearTimeout(waitr);

        // User has a crashy browser.
        if (getTotalNumberOfCrashes('week', 'main') > 2) {
            $('#crashyfox').show('slow');
        }

        // We need at least 5 sessions with data.
        if (getSessionsCount() < 5) {
            $('#hungryfox').show('slow');
        } else {
            // We have enough data, show the graph UI and draw the graph. By
            // default, we draw the average startup times.
            drawGraph(true);
        }
    }
